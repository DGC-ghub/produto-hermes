// A fila do onboarding assistido: claim atômico, lease com heartbeat e as faxinas.
//
// Mesmo padrão de `whatsapp-queue.server.ts`, com uma diferença que muda tudo: lá o
// processamento leva segundos, aqui leva MINUTOS (são agentes). Por isso existem lease
// (`claimToken`), heartbeat e backoff — coisas que a fila do WhatsApp não precisa.
//
// As decisões (quando re-tentar, o que alarma, o que pode ir para `lastError`) são puras e
// moram em `job.ts`. Aqui fica só o que depende do banco: as garantias que o
// compare-and-swap dá e nada mais.
//
// Referência: spec §6.3 (padrão da fila), §6.4 (taxonomia), §6.5 (backoff, heartbeat, lease).
import { db } from '../../db.server'
import { reportDegradation } from '../alarm.server'
import {
  decidirDesfecho,
  type FailureKind,
  LEASE_ORFAO_MS,
  LOTE,
  MAX_ATTEMPTS,
  proximaTentativaEm,
  SWEEP_INTERVAL_MS,
  sanitizarErro,
  workerHabilitado,
} from './job'

/**
 * O snapshot que o processamento recebe (§6.1). É IMUTÁVEL de propósito: o processador
 * nunca relê `answersJson` depois do claim — se o cliente editar no meio, o que está sendo
 * gerado tem que continuar sendo o que foi submetido, senão a revisão interna aprova uma
 * coisa e publica outra.
 */
export type JobReivindicado = {
  id: string
  versionId: string
  tenantId: string
  kind: string
  generation: number
  /** Já contando esta tentativa. */
  attempts: number
  /** A chave do lease: sem ela não se escreve mais nada neste job. */
  claimToken: string
}

/**
 * Pega o próximo job da fila, se houver.
 *
 * FIFO por `nextAttemptAt` e lote 1. O claim é um `updateMany` condicional: só quem virou
 * a linha de `pending` para `processing` leva o job. O `claimToken` nasce aqui e passa a
 * ser exigido em toda escrita seguinte — é o que impede um processo que ficou pendurado de
 * voltar do limbo e sobrescrever o trabalho de quem herdou o job.
 */
export async function claimNextSetupJob(agora = new Date()): Promise<JobReivindicado | null> {
  const candidatos = await db.aiSetupJob.findMany({
    where: {
      status: 'pending',
      nextAttemptAt: { lte: agora },
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: LOTE,
  })

  for (const candidato of candidatos) {
    const claimToken = crypto.randomUUID()
    const claimed = await db.aiSetupJob.updateMany({
      // `status: 'pending'` no `where` é o que torna o claim atômico: outro processo que
      // tentar o mesmo job encontra a linha já virada e conta 0.
      where: { id: candidato.id, status: 'pending' },
      data: {
        status: 'processing',
        claimedAt: agora,
        // `startedAt` guarda o começo do TRABALHO, não da tentativa: uma re-tentativa não
        // apaga quando a fila pegou o job pela primeira vez.
        startedAt: candidato.startedAt ?? agora,
        claimToken,
        attempts: { increment: 1 },
      },
    })
    if (claimed.count !== 1) {
      continue
    }
    return {
      id: candidato.id,
      versionId: candidato.versionId,
      tenantId: candidato.tenantId,
      kind: candidato.kind,
      generation: candidato.generation,
      attempts: candidato.attempts + 1,
      claimToken,
    }
  }
  return null
}

/**
 * Renova o lease. Devolve `false` quando o job já não é nosso — e aí quem está
 * processando deve PARAR: outro processo herdou o job e vai gerar a mesma configuração.
 */
export async function heartbeatSetupJob(id: string, claimToken: string): Promise<boolean> {
  const { count } = await db.aiSetupJob.updateMany({
    where: { id, status: 'processing', claimToken },
    data: { claimedAt: new Date() },
  })
  return count === 1
}

/** Marca o job como concluído. `false` se o lease já era de outro. */
export async function completeSetupJob(id: string, claimToken: string): Promise<boolean> {
  const { count } = await db.aiSetupJob.updateMany({
    where: { id, status: 'processing', claimToken },
    data: { status: 'completed', finishedAt: new Date(), failureKind: null, lastError: null },
  })
  return count === 1
}

export type ResultadoDaFalha = {
  status: 'retry_wait' | 'failed'
  alarmou: boolean
  /** Quando volta a ficar elegível (só em `retry_wait`). */
  proximaTentativaEm: Date | null
}

/**
 * Registra a falha e decide o destino do job.
 *
 * As tentativas vêm do BANCO, não do chamador: quem está processando pode ter perdido o
 * lease sem saber, e decidir "esgotou" com um número errado marcaria como definitivo um
 * job que ainda tinha chance.
 *
 * Devolve `null` quando o lease já não é nosso — nesse caso nada foi escrito.
 */
export async function failSetupJob(
  id: string,
  claimToken: string,
  kind: FailureKind,
  error: unknown,
  agora = new Date(),
): Promise<ResultadoDaFalha | null> {
  const atual = await db.aiSetupJob.findFirst({
    where: { id, status: 'processing', claimToken },
    select: { attempts: true },
  })
  if (!atual) {
    return null
  }

  const desfecho = decidirDesfecho(kind, atual.attempts)
  const proxima =
    desfecho.status === 'retry_wait' ? proximaTentativaEm(atual.attempts, agora) : null

  const { count } = await db.aiSetupJob.updateMany({
    where: { id, status: 'processing', claimToken },
    data: {
      status: desfecho.status,
      failureKind: kind,
      lastError: sanitizarErro(error),
      // O lease morre junto com a tentativa: quem re-tentar ganha um token novo.
      claimToken: null,
      claimedAt: null,
      finishedAt: desfecho.status === 'failed' ? agora : null,
      ...(proxima ? { nextAttemptAt: proxima } : {}),
    },
  })
  if (count !== 1) {
    return null
  }

  if (desfecho.alarmar) {
    void reportDegradation('setup_job_falhou')
  }
  return { status: desfecho.status, alarmou: desfecho.alarmar, proximaTentativaEm: proxima }
}

export type ResultadoDaVarredura = {
  /** `processing` sem heartbeat há muito tempo, devolvidos à fila. */
  orfaos: number
  /** `retry_wait` cuja espera venceu. */
  liberados: number
  /** `pending` que já não tem tentativa sobrando. */
  esgotados: number
}

/**
 * As faxinas. NÃO reivindica nada — só arruma o estado da fila, e por isso roda mesmo com
 * o worker desligado: um job órfão de um `Ctrl+C` precisa voltar para `pending` de
 * qualquer forma, senão ele fica invisível para o comando assistido.
 */
export async function varrerJobs(agora = new Date()): Promise<ResultadoDaVarredura> {
  // 1. Órfão: o dono do lease sumiu (crash, Ctrl+C, máquina desligada) e parou de bater o
  //    heartbeat. Volta para a fila SEM token — quem pegar ganha um novo.
  const orfaos = await db.aiSetupJob.updateMany({
    where: { status: 'processing', claimedAt: { lt: new Date(agora.getTime() - LEASE_ORFAO_MS) } },
    data: { status: 'pending', claimToken: null, claimedAt: null },
  })

  // 2. Espera cumprida: `retry_wait` volta a ser elegível.
  const liberados = await db.aiSetupJob.updateMany({
    where: { status: 'retry_wait', nextAttemptAt: { lte: agora } },
    data: { status: 'pending' },
  })

  // 3. Zumbi: `pending` sem tentativa sobrando. Acontece quando o processo morre DENTRO da
  //    última tentativa — o `failSetupJob` nunca rodou, então ninguém marcou como falho e
  //    o job ficava invisível para o filtro do claim, sem nunca ser alarmado.
  const esgotados = await db.aiSetupJob.updateMany({
    where: { status: 'pending', attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'failed', failureKind: 'transient', finishedAt: agora },
  })
  if (esgotados.count > 0) {
    void reportDegradation('setup_job_esgotado')
  }

  return { orfaos: orfaos.count, liberados: liberados.count, esgotados: esgotados.count }
}

/** Quantos jobs esperam atenção agora — o que o comando assistido mostra antes de agir. */
export async function contarFilaDeSetup(agora = new Date()) {
  const [pendentes, processando, esperando, falhos] = await Promise.all([
    db.aiSetupJob.count({
      where: { status: 'pending', nextAttemptAt: { lte: agora }, attempts: { lt: MAX_ATTEMPTS } },
    }),
    db.aiSetupJob.count({ where: { status: 'processing' } }),
    db.aiSetupJob.count({ where: { status: 'retry_wait' } }),
    db.aiSetupJob.count({ where: { status: 'failed' } }),
  ])
  return { pendentes, processando, esperando, falhos }
}

// ── Sweeper ─────────────────────────────────────────────────────────────────────
// `setInterval` + `unref()` (o timer não segura o processo nem o vitest abertos) + guard
// em `globalThis` (o HMR do dev não empilha timers). Mesmo padrão do sweeper da fila do
// WhatsApp.
declare global {
  var __hermesSetupJobSweeper: ReturnType<typeof setInterval> | undefined
}

export function startSetupJobSweeper(): void {
  if (globalThis.__hermesSetupJobSweeper) {
    return
  }
  const timer = setInterval(() => {
    // Só as faxinas. Reivindicar aqui seria ligar o worker automático pela porta dos
    // fundos — e a spec (§6.2) desliga por padrão justamente porque um job de minutos
    // faria mensagem de cliente real esperar e cair no fallback.
    void varrerJobs().catch((error) => {
      console.error(
        '[setup-queue] varredura falhou:',
        error instanceof Error ? error.message : error,
      )
    })
  }, SWEEP_INTERVAL_MS)
  timer.unref()
  globalThis.__hermesSetupJobSweeper = timer
}

/** O worker automático está ligado? Lê o ambiente do processo (§6.2). */
export function setupWorkerHabilitado(): boolean {
  return workerHabilitado(process.env)
}
