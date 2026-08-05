// A fila do onboarding assistido: claim atômico, lease com heartbeat e as faxinas.
//
// Mesmo padrão de `whatsapp-queue.server.ts`, com uma diferença que muda tudo: lá o
// processamento leva segundos, aqui leva MINUTOS (são agentes). Por isso existem lease
// (`claimToken`), heartbeat e backoff — coisas que a fila do WhatsApp não precisa.
//
// As decisões (quando re-tentar, o que alarma, quais códigos de erro existem) são puras e
// moram em `job.ts`. Aqui fica só o que depende do banco: as garantias que o
// compare-and-swap e a transação dão, e nada mais.
//
// Referência: spec §6.1 (contrato), §6.3 (padrão da fila), §6.4 (taxonomia), §6.5 (lease).
import type { Prisma } from '../../../generated/prisma/client.js'
import { db } from '../../db.server'
import { reportSetupIncident } from '../alarm.server'
import { parseAnswers, type SetupAnswers } from './answers'
import {
  type CodigoErro,
  decidirDesfecho,
  ehCodigoConhecido,
  type FailureKind,
  LEASE_ORFAO_MS,
  MAX_ATTEMPTS,
  proximaTentativaEm,
  SWEEP_INTERVAL_MS,
  sanitizarErro,
  workerHabilitado,
} from './job'
import { comRetry } from './retry'
import { assertSetupTransition } from './state'

/**
 * Quantos candidatos o claim olha antes de desistir.
 *
 * O LOTE de processamento é 1 (o Claude CLI tem concorrência 1), mas olhar um candidato só
 * é diferente: quem perde a corrida pelo primeiro job voltaria de mãos vazias com a fila
 * cheia. Aqui ele tenta o próximo.
 */
const CANDIDATOS_POR_CLAIM = 5

/**
 * O snapshot que o processamento recebe (§6.1). IMUTÁVEL de propósito: é lido UMA vez, no
 * claim, e o processador nunca volta ao banco atrás de `answersJson`. Se o cliente reabrir
 * e editar no meio, o que está sendo gerado continua sendo o que foi submetido — senão a
 * revisão interna aprova uma coisa e publica outra.
 */
export type JobReivindicado = {
  id: string
  versionId: string
  tenantId: string
  tenantSlug: string
  kind: string
  generation: number
  answers: SetupAnswers
  /** Já contando esta tentativa. */
  attempts: number
  /** A chave do lease: sem ela não se escreve mais nada neste job. */
  claimToken: string
}

/** Cria o job de geração. Vive aqui porque o formato da chave é assunto da fila. */
export function criarJobDeGeracao(
  tx: Prisma.TransactionClient,
  input: { versionId: string; tenantId: string; generation: number },
) {
  return tx.aiSetupJob.create({
    data: {
      versionId: input.versionId,
      tenantId: input.tenantId,
      kind: 'generate',
      generation: input.generation,
      // Dois cliques em "enviar" não viram dois jobs.
      idempotencyKey: `${input.versionId}:${input.generation}:generate:1`,
    },
  })
}

/**
 * Pega o próximo job da fila, se houver, e devolve o snapshot completo.
 *
 * FIFO por `nextAttemptAt`, desempatado por `createdAt` e `id` — sem desempate, dois jobs
 * agendados no mesmo milissegundo (o que acontece: `nextAttemptAt` default é `now()`) sairiam
 * em ordem indefinida, e um deles podia ficar para trás indefinidamente.
 *
 * O claim e o evento `job_started` vão na MESMA transação: um job reivindicado sem registro
 * de início é um buraco na auditoria bem no ponto em que alguém vai perguntar "quem gerou
 * essa configuração e quando".
 */
export async function claimNextSetupJob(agora = new Date()): Promise<JobReivindicado | null> {
  const candidatos = await db.aiSetupJob.findMany({
    where: {
      status: 'pending',
      nextAttemptAt: { lte: agora },
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: CANDIDATOS_POR_CLAIM,
  })

  for (const candidato of candidatos) {
    const claimToken = crypto.randomUUID()
    const snapshot = await comRetry((opcoes) =>
      db.$transaction(async (tx) => {
        const claimed = await tx.aiSetupJob.updateMany({
          // `status: 'pending'` no `where` é o que torna o claim atômico: outro processo
          // que tentar o mesmo job encontra a linha já virada e conta 0.
          where: { id: candidato.id, status: 'pending' },
          data: {
            status: 'processing',
            claimedAt: agora,
            // `startedAt` guarda o começo do TRABALHO, não da tentativa: uma re-tentativa
            // não apaga quando a fila pegou o job pela primeira vez.
            startedAt: candidato.startedAt ?? agora,
            claimToken,
            attempts: { increment: 1 },
          },
        })
        if (claimed.count !== 1) {
          return null
        }

        // O snapshot é montado AQUI DENTRO, junto do claim: lido depois, ele poderia já
        // refletir uma edição que aconteceu entre uma coisa e outra.
        const version = await tx.aiSetupVersion.findFirst({
          where: { id: candidato.versionId, tenantId: candidato.tenantId },
          select: { answersJson: true, tenant: { select: { slug: true } } },
        })
        if (!version) {
          // Job apontando para versão que não é do tenant dele. Não dá para processar e
          // não adianta re-tentar: sai como terminal, com registro.
          throw new SnapshotImpossivelError(candidato.id, claimToken)
        }

        await tx.aiSetupEvent.create({
          data: {
            tenantId: candidato.tenantId,
            versionId: candidato.versionId,
            kind: 'job_started',
            actor: 'job',
            detail: JSON.stringify({
              jobId: candidato.id,
              generation: candidato.generation,
              attempt: candidato.attempts + 1,
            }),
          },
        })

        return {
          id: candidato.id,
          versionId: candidato.versionId,
          tenantId: candidato.tenantId,
          tenantSlug: version.tenant.slug,
          kind: candidato.kind,
          generation: candidato.generation,
          answers: parseAnswers(version.answersJson),
          attempts: candidato.attempts + 1,
          claimToken,
        }
      }, opcoes),
    ).catch(async (error) => {
      if (!(error instanceof SnapshotImpossivelError)) {
        throw error
      }
      // A transação foi revertida (o job voltou a `pending`), então o CAS de falha não
      // casaria. Marca fora dela, direto, e segue para o próximo candidato.
      await marcarJobInvalido(candidato.id, agora)
      return null
    })

    if (snapshot) {
      return snapshot
    }
  }
  return null
}

/** Sinaliza job cujo snapshot não pode ser montado — a transação do claim é revertida. */
class SnapshotImpossivelError extends Error {
  constructor(
    readonly jobId: string,
    readonly claimToken: string,
  ) {
    super(`Job ${jobId} aponta para versão que não é do tenant dele`)
    this.name = 'SnapshotImpossivelError'
  }
}

/** Job estruturalmente quebrado: sai da fila como terminal, com alarme. */
async function marcarJobInvalido(id: string, agora: Date): Promise<void> {
  await db.aiSetupJob.updateMany({
    where: { id, status: 'pending' },
    data: {
      status: 'failed',
      failureKind: 'terminal',
      lastError: 'validacao_reprovou' satisfies CodigoErro,
      finishedAt: agora,
      claimToken: null,
      claimedAt: null,
    },
  })
  void reportSetupIncident('job com versão inconsistente')
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

/** O que o job produz (§6.1). Tudo JSON serializado — o formato é assunto do processador. */
export type ArtefatosDoJob = {
  candidateConfigJson: string
  candidateKnowledgeJson: string
  summaryJson: string
  gapsJson: string
  risksJson: string
  validationJson: string
}

export type ResultadoFinal =
  | { ok: true }
  /** O lease já era de outro: outro processo herdou o job. Nada foi escrito. */
  | { ok: false; motivo: 'lease_perdido' }
  /** A versão saiu de baixo (nova geração, ou já mudou de estado). Nada foi escrito. */
  | { ok: false; motivo: 'versao_mudou' }

/**
 * A transação final: artefatos, estado da versão, conclusão do job e evento — TUDO junto.
 *
 * É uma transação só porque as quatro coisas são a mesma coisa. Gravar artefato e falhar
 * ao concluir deixaria o job voltando à fila para gerar de novo por cima do que já estava
 * lá; concluir sem evento deixaria a auditoria sem o desfecho justamente do passo que
 * produz a configuração que vai atender cliente.
 *
 * Dois compare-and-swap guardam a escrita: o do LEASE (o job ainda é nosso) e o da VERSÃO
 * (mesma geração e mesmo estado). O segundo é o que impede um job obsoleto — o cliente
 * reabriu e submeteu de novo enquanto este rodava — de sobrescrever a candidata nova.
 */
export async function finalizarJobComSucesso(input: {
  jobId: string
  claimToken: string
  versionId: string
  tenantId: string
  /** A geração que o job carregava. A versão precisa continuar nela (§4.8). */
  generation: number
  artefatos: ArtefatosDoJob
  /** `needs_changes` quando o agente achou lacunas de negócio (§6.4); senão null. */
  proximoEstado: 'needs_changes' | null
  agora?: Date
}): Promise<ResultadoFinal> {
  const agora = input.agora ?? new Date()
  if (input.proximoEstado) {
    // A regra de transição é conferida ANTES de abrir a transação: se for inválida, isto
    // é bug de chamada e tem que estourar, não virar rollback silencioso.
    assertSetupTransition('submitted', input.proximoEstado, 'job')
  }

  let motivo: 'lease_perdido' | 'versao_mudou' | null = null

  await comRetry((opcoes) =>
    db.$transaction(async (tx) => {
      const versao = await tx.aiSetupVersion.updateMany({
        where: {
          id: input.versionId,
          tenantId: input.tenantId,
          generation: input.generation,
          state: 'submitted',
        },
        data: {
          ...input.artefatos,
          ...(input.proximoEstado ? { state: input.proximoEstado } : {}),
        },
      })
      if (versao.count !== 1) {
        motivo = 'versao_mudou'
        throw new AbortarFinalizacao()
      }

      const job = await tx.aiSetupJob.updateMany({
        where: { id: input.jobId, status: 'processing', claimToken: input.claimToken },
        data: {
          status: 'completed',
          finishedAt: agora,
          failureKind: null,
          lastError: null,
          claimToken: null,
          claimedAt: null,
        },
      })
      if (job.count !== 1) {
        motivo = 'lease_perdido'
        throw new AbortarFinalizacao()
      }

      await tx.aiSetupEvent.create({
        data: {
          tenantId: input.tenantId,
          versionId: input.versionId,
          kind: 'job_completed',
          actor: 'job',
          detail: JSON.stringify({
            jobId: input.jobId,
            generation: input.generation,
            proximoEstado: input.proximoEstado,
          }),
        },
      })
    }, opcoes),
  ).catch((error) => {
    if (!(error instanceof AbortarFinalizacao)) {
      throw error
    }
  })

  return motivo ? { ok: false, motivo } : { ok: true }
}

/** Desfaz a transação final sem virar erro para o chamador — o motivo vem à parte. */
class AbortarFinalizacao extends Error {
  constructor() {
    super('finalização abortada')
    this.name = 'AbortarFinalizacao'
  }
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
 * O que vai para o banco é o CÓDIGO; o detalhe do erro vai para o log do processo. A
 * atualização e o evento `job_failed` vão juntos, pelo mesmo motivo da finalização.
 *
 * Devolve `null` quando o lease já não é nosso — nesse caso nada foi escrito.
 */
export async function failSetupJob(input: {
  jobId: string
  claimToken: string
  tenantId: string
  versionId: string
  kind: FailureKind
  codigo: CodigoErro
  /** Só para o log local. Nunca chega ao banco. */
  detalhe?: unknown
  agora?: Date
}): Promise<ResultadoDaFalha | null> {
  const agora = input.agora ?? new Date()
  const codigo = ehCodigoConhecido(input.codigo) ? input.codigo : 'erro_desconhecido'

  const atual = await db.aiSetupJob.findFirst({
    where: { id: input.jobId, status: 'processing', claimToken: input.claimToken },
    select: { attempts: true },
  })
  if (!atual) {
    return null
  }

  const desfecho = decidirDesfecho(input.kind, atual.attempts)
  const proxima =
    desfecho.status === 'retry_wait' ? proximaTentativaEm(atual.attempts, agora) : null

  let escreveu = false
  await comRetry((opcoes) =>
    db.$transaction(async (tx) => {
      const { count } = await tx.aiSetupJob.updateMany({
        where: { id: input.jobId, status: 'processing', claimToken: input.claimToken },
        data: {
          status: desfecho.status,
          failureKind: input.kind,
          lastError: codigo,
          // O lease morre junto com a tentativa: quem re-tentar ganha um token novo.
          claimToken: null,
          claimedAt: null,
          finishedAt: desfecho.status === 'failed' ? agora : null,
          ...(proxima ? { nextAttemptAt: proxima } : {}),
        },
      })
      if (count !== 1) {
        throw new AbortarFinalizacao()
      }
      await tx.aiSetupEvent.create({
        data: {
          tenantId: input.tenantId,
          versionId: input.versionId,
          kind: 'job_failed',
          actor: 'job',
          detail: JSON.stringify({
            jobId: input.jobId,
            failureKind: input.kind,
            codigo,
            attempt: atual.attempts,
            status: desfecho.status,
          }),
        },
      })
      escreveu = true
    }, opcoes),
  ).catch((error) => {
    if (!(error instanceof AbortarFinalizacao)) {
      throw error
    }
  })

  if (!escreveu) {
    return null
  }

  // O detalhe fica no log do processo — é onde se depura sem expor resposta de empresa
  // na auditoria nem no banco de fila.
  const detalhe = input.detalhe === undefined ? '' : `: ${sanitizarErro(input.detalhe)}`
  console.error(
    `[setup-queue] job ${input.jobId} falhou (${input.kind}/${codigo}, tentativa ${atual.attempts})${detalhe}`,
  )
  if (desfecho.alarmar) {
    void reportSetupIncident(`job ${input.jobId} falhou (${codigo})`)
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
    data: {
      status: 'failed',
      failureKind: 'transient',
      lastError: 'erro_desconhecido' satisfies CodigoErro,
      finishedAt: agora,
    },
  })
  if (esgotados.count > 0) {
    void reportSetupIncident(`${esgotados.count} job(s) esgotaram as tentativas`)
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
      console.error('[setup-queue] varredura falhou:', sanitizarErro(error))
    })
  }, SWEEP_INTERVAL_MS)
  timer.unref()
  globalThis.__hermesSetupJobSweeper = timer
}

/** O worker automático está ligado? Lê o ambiente do processo (§6.2). */
export function setupWorkerHabilitado(): boolean {
  return workerHabilitado(process.env)
}

// Liga o sweeper na carga do módulo, como a fila do WhatsApp. As faxinas rodam MESMO com o
// worker desligado: elas não reivindicam nada, só desfazem estado preso — um job órfão de
// um `Ctrl+C` no comando assistido ficaria `processing` para sempre, invisível na próxima
// execução, se ninguém varresse.
//
// Fora dos testes: um `setInterval` mexendo na fila no meio de uma asserção produziria
// vermelho aleatório, e a varredura já é chamada diretamente pelos testes.
if (!process.env.VITEST) {
  startSetupJobSweeper()
}
