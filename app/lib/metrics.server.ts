// Persistência das medições de latência (uma linha por mensagem) e leitura
// agregada. A estatística em si é pura e vive em `metrics.ts`; aqui só entra o
// banco. Server-side — não importar em componente React.
//
// Contrato inegociável: medir NUNCA pode quebrar ou atrasar o atendimento.
// Toda gravação é best-effort (engole o próprio erro) e o chamador dispara sem
// esperar — mesmo padrão já usado no alarme.

import { db } from '../db.server'
import {
  buildReport,
  type LatencyReport,
  type StepDurations,
  type TraceResult,
  type TraceSample,
} from './metrics'

/** Desfecho da mensagem — o "porquê" por trás de uma latência. */
/**
 * O desfecho de uma mensagem.
 *
 * `human_handling` cobria três fenômenos diferentes e caros de confundir: o humano que JÁ
 * conduzia quando a mensagem chegou (o motor nem gastou cérebro), o que assumiu no meio do
 * raciocínio (uma resposta de dezenas de segundos jogada fora) e — depois que o CAS virou
 * allowlist — a conversa encerrada ou apagada, onde humano nenhum assumiu coisa alguma.
 *
 * A taxonomia é deliberadamente curta: em vez de multiplicar `fase × estado`, a FASE sai de
 * `brainMs`. O número caro fica a uma consulta de distância:
 *
 *   WHERE outcome = 'human_took_over' AND brainMs IS NOT NULL
 */
export type TraceOutcome =
  | 'ok' //                     respondida pelo cérebro
  | 'fallback' //               cérebro falhou/foi recusado, cliente recebeu a resposta genérica
  | 'guard_handoff' //          guard-rail curto-circuitou antes do LLM (barato de propósito)
  | 'billing_blocked' //        assinatura inativa
  | 'human_at_entry' //         humano já conduzia quando a mensagem chegou
  | 'human_took_over' //        humano assumiu durante o processamento (veja `brainMs`)
  | 'conversation_closed' //    encerrada durante o processamento
  | 'conversation_missing' //   apagada durante o processamento
  | 'authority_lost_unknown' // status desconhecido: silêncio fail-closed
  | 'erro' //                   exceção no meio do fluxo

export type RecordTraceInput = {
  tenantId: string
  conversationId?: string
  channel: string
  provider: string
  outcome: TraceOutcome
  trace: TraceResult
}

const DEFAULT_RETENTION_DAYS = 14
const DEFAULT_WINDOW_MINUTES = 60
/** Teto de amostras lidas por relatório — protege o Pi de uma janela muito larga. */
const MAX_SAMPLES = 5000
/** A cada quantas gravações rodamos a poda (evita um DELETE por mensagem). */
const PRUNE_EVERY = 200

/** Medição pode ser desligada por env se algum dia pesar no Pi. Ligada por padrão. */
export function metricsEnabled(): boolean {
  return process.env.HERMES_METRICS !== '0'
}

function retentionDays(): number {
  const raw = Number(process.env.HERMES_METRICS_RETENTION_DAYS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETENTION_DAYS
}

let sinceLastPrune = 0

/**
 * Grava a medição de uma mensagem. Best-effort: qualquer erro é engolido (com log),
 * porque uma falha ao MEDIR não pode virar uma falha em ATENDER.
 */
export async function recordMessageTrace(input: RecordTraceInput): Promise<void> {
  if (!metricsEnabled()) {
    return
  }
  try {
    await db.messageTrace.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId ?? null,
        channel: input.channel,
        provider: input.provider,
        outcome: input.outcome,
        totalMs: input.trace.totalMs,
        brainMs: input.trace.steps.brain ?? null,
        stepsJson: JSON.stringify(input.trace.steps),
      },
    })

    sinceLastPrune += 1
    if (sinceLastPrune >= PRUNE_EVERY) {
      sinceLastPrune = 0
      await pruneOldTraces()
    }
  } catch (error) {
    console.error(
      '[metrics] falha ao gravar trace (ignorada):',
      error instanceof Error ? error.message : error,
    )
  }
}

/**
 * Apaga medições além da retenção. Telemetria não pode crescer sem fim num
 * cartão SD. Devolve quantas linhas saíram.
 */
export async function pruneOldTraces(days: number = retentionDays()): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const result = await db.messageTrace.deleteMany({ where: { createdAt: { lt: cutoff } } })
  return result.count
}

/** Desserializa `stepsJson` tolerando lixo — um registro corrompido não derruba o relatório. */
export function parseSteps(raw: string): StepDurations {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const steps: StepDurations = {}
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        steps[name] = value
      }
    }
    return steps
  } catch {
    return {}
  }
}

/**
 * Relatório de latência da janela recente. `tenantSlug` restringe a um cliente
 * (o relatório global mistura demo pública e WhatsApp pagante, que têm perfis
 * de tempo bem diferentes).
 */
export async function readLatencyReport(
  opts: { windowMinutes?: number; tenantSlug?: string } = {},
): Promise<LatencyReport> {
  const windowMinutes = opts.windowMinutes ?? DEFAULT_WINDOW_MINUTES
  const since = new Date(Date.now() - windowMinutes * 60 * 1000)

  let tenantId: string | undefined
  if (opts.tenantSlug) {
    const tenant = await db.tenant.findUnique({
      where: { slug: opts.tenantSlug },
      select: { id: true },
    })
    // Slug inexistente devolve relatório vazio — melhor que ignorar o filtro e
    // mostrar os números de todo mundo achando que são de um cliente só.
    if (!tenant) {
      return buildReport([], windowMinutes)
    }
    tenantId = tenant.id
  }

  const rows = await db.messageTrace.findMany({
    where: { createdAt: { gte: since }, ...(tenantId ? { tenantId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: MAX_SAMPLES,
    select: { totalMs: true, stepsJson: true, outcome: true, provider: true },
  })

  const samples: TraceSample[] = rows.map((row) => ({
    totalMs: row.totalMs,
    steps: parseSteps(row.stepsJson),
    outcome: row.outcome,
    provider: row.provider,
  }))

  return buildReport(samples, windowMinutes)
}

/** Só para teste: zera o contador de poda do processo. */
export function __resetPruneCounter(): void {
  sinceLastPrune = 0
}
