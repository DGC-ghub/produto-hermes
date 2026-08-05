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
// DUAS REGRAS que valem para o arquivo inteiro:
//
//  1. O JOB é a autoridade sobre tenant, versão e geração. Nenhuma função aceita esses
//     valores do chamador: quem processa pode estar com dado velho na mão, e um evento
//     gravado contra a versão errada é pior que evento nenhum.
//  2. Nada de estado mutável fora dos callbacks de transação. O `comRetry` pode rodar o
//     callback mais de uma vez; uma variável de fora sobreviveria a um rollback e faria a
//     função reportar sucesso por uma escrita que foi desfeita. O resultado sai por
//     `return` (ou por erro tipado), sempre da tentativa que confirmou.
//
// Referência: spec §6.1 (contrato), §6.3 (padrão da fila), §6.4 (taxonomia), §6.5 (lease).
import type { Prisma } from '../../../generated/prisma/client.js'
import { db } from '../../db.server'
import { reportSetupIncident } from '../alarm.server'
import { isReadyToSubmit, parseAnswers, type SetupAnswers } from './answers'
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

/** Quantos candidatos cada busca traz. */
const CANDIDATOS_POR_BUSCA = 5

/**
 * Teto de candidatos que um claim descarta antes de desistir.
 *
 * Existe porque parar nos cinco primeiros dava FALSO VAZIO: cinco jobs inválidos (ou cinco
 * CAS perdidos) na frente de um sexto válido faziam o comando anunciar "fila vazia" com a
 * fila cheia. Agora ele pagina; o teto é só para o laço não ficar eterno se algo estiver
 * produzindo candidatos sem parar.
 */
const TETO_DE_CANDIDATOS = 50

/** Todos os eventos da fila entram como `system` — é o processo, não uma pessoa. */
const ATOR = 'system'

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

// ── Claim ───────────────────────────────────────────────────────────────────────

/** Por que um job não pode ser processado. Vira `failureKind` + código. */
type MotivoNaoProcessavel =
  | 'versao_ausente'
  | 'setup_divergente'
  | 'ponteiro_divergente'
  | 'tipo_desconhecido'
  | 'geracao_obsoleta'
  | 'geracao_impossivel'
  | 'estado_invalido'
  | 'respostas_incompletas'

/** Sinaliza job que não deve ser processado — a transação do claim é revertida. */
class JobNaoProcessavelError extends Error {
  constructor(readonly motivo: MotivoNaoProcessavel) {
    super(`job não processável: ${motivo}`)
    this.name = 'JobNaoProcessavelError'
  }
}

type Classificacao = {
  kind: FailureKind
  codigo: CodigoErro
  alarmar: boolean
  /**
   * O evento pode citar a versão?
   *
   * Quando o job aponta para versão que NÃO é deste tenant, citar o id amarraria, na
   * auditoria de uma empresa, a versão de outra. O evento fica com `versionId: null` e o
   * motivo no `detail` — some o vazamento, não a rastreabilidade.
   */
  citarVersao: boolean
}

/**
 * Geração obsoleta é o sistema funcionando (§4.8): o cliente submeteu de novo e este job
 * ficou para trás. Não alarma e não é "terminal" — é `superseded`.
 *
 * Geração MAIOR que a da versão é outra coisa: o job diz ter nascido de uma geração que a
 * versão nunca alcançou. Isso não acontece pelo caminho normal, então é corrupção — sai
 * terminal e alarma. Tratá-la como obsoleta esconderia justamente o caso grave.
 */
function classificar(motivo: MotivoNaoProcessavel): Classificacao {
  if (motivo === 'geracao_obsoleta') {
    return { kind: 'superseded', codigo: 'geracao_obsoleta', alarmar: false, citarVersao: true }
  }
  const daOutraEmpresa = motivo === 'versao_ausente' || motivo === 'setup_divergente'
  return {
    kind: 'terminal',
    codigo: 'validacao_reprovou',
    alarmar: true,
    citarVersao: !daOutraEmpresa,
  }
}

/**
 * O desfecho de uma tentativa de claim.
 *
 * `empty` e `limit_reached` são coisas DIFERENTES e o tipo obriga quem chama a tratar as
 * duas: `empty` é consulta que voltou vazia; `limit_reached` é "inspecionei o teto de
 * candidatos e todos foram descartados ou perdidos" — pode haver job válido logo atrás.
 * Anunciar "fila vazia" nesse caso manda a pessoa embora com trabalho na fila.
 */
export type ResultadoClaim =
  | { tipo: 'claimed'; job: JobReivindicado }
  | { tipo: 'empty' }
  | { tipo: 'limit_reached'; inspecionados: number }

/**
 * Pega o próximo job PROCESSÁVEL da fila.
 *
 * FIFO por `nextAttemptAt`, desempatado por `createdAt` e `id` — sem desempate, dois jobs
 * agendados no mesmo milissegundo (o que acontece: o default é `now()`) sairiam em ordem
 * indefinida e um deles podia ficar para trás. Pagina enquanto houver candidato.
 */
export async function claimNextSetupJob(agora = new Date()): Promise<ResultadoClaim> {
  const tentados: string[] = []

  while (tentados.length < TETO_DE_CANDIDATOS) {
    const candidatos = await db.aiSetupJob.findMany({
      where: {
        status: 'pending',
        nextAttemptAt: { lte: agora },
        attempts: { lt: MAX_ATTEMPTS },
        ...(tentados.length > 0 ? { id: { notIn: tentados } } : {}),
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: CANDIDATOS_POR_BUSCA,
    })
    if (candidatos.length === 0) {
      return { tipo: 'empty' }
    }

    for (const candidato of candidatos) {
      tentados.push(candidato.id)
      const snapshot = await tentarReivindicar(candidato, agora)
      if (snapshot) {
        return { tipo: 'claimed', job: snapshot }
      }
    }
  }
  return { tipo: 'limit_reached', inspecionados: tentados.length }
}

type CandidatoDeJob = {
  id: string
  versionId: string
  tenantId: string
  kind: string
  generation: number
  attempts: number
  startedAt: Date | null
}

/**
 * Uma tentativa de claim: vira a linha, CONFERE se o job é processável e monta o snapshot
 * — tudo na mesma transação.
 *
 * A conferência é a parte que não pode faltar. `reviewVersionId` é a fonte da verdade do
 * que está em elaboração; uma versão `submitted` que o setup não aponta mais é resto de um
 * ciclo anterior, e gerar configuração em cima dela produziria uma candidata que ninguém
 * pediu — que depois alguém aprovaria achando que é a atual.
 */
async function tentarReivindicar(
  candidato: CandidatoDeJob,
  agora: Date,
): Promise<JobReivindicado | null> {
  const claimToken = crypto.randomUUID()

  try {
    return await comRetry((opcoes) =>
      db.$transaction(async (tx) => {
        const claimed = await tx.aiSetupJob.updateMany({
          // `status: 'pending'` no `where` é o que torna o claim atômico: outro processo
          // que tentar o mesmo job encontra a linha já virada e conta 0.
          where: { id: candidato.id, status: 'pending' },
          data: {
            status: 'processing',
            claimedAt: agora,
            // `startedAt` guarda o começo do TRABALHO, não da tentativa.
            startedAt: candidato.startedAt ?? agora,
            claimToken,
            attempts: { increment: 1 },
          },
        })
        if (claimed.count !== 1) {
          return null // outro processo levou
        }

        const version = await tx.aiSetupVersion.findFirst({
          where: { id: candidato.versionId, tenantId: candidato.tenantId },
          select: {
            id: true,
            setupId: true,
            state: true,
            generation: true,
            answersJson: true,
            tenant: { select: { slug: true } },
          },
        })
        if (!version) {
          throw new JobNaoProcessavelError('versao_ausente')
        }

        const setup = await tx.aiSetup.findUnique({
          where: { tenantId: candidato.tenantId },
          select: { id: true, reviewVersionId: true },
        })
        if (!setup || version.setupId !== setup.id) {
          throw new JobNaoProcessavelError('setup_divergente')
        }
        if (setup.reviewVersionId !== version.id) {
          throw new JobNaoProcessavelError('ponteiro_divergente')
        }
        if (candidato.kind !== 'generate') {
          // A fila só sabe gerar. Um `kind` que ninguém implementou seria reivindicado,
          // processado como se fosse geração e produziria artefato errado em silêncio.
          throw new JobNaoProcessavelError('tipo_desconhecido')
        }
        if (candidato.generation < version.generation) {
          throw new JobNaoProcessavelError('geracao_obsoleta')
        }
        if (candidato.generation > version.generation) {
          throw new JobNaoProcessavelError('geracao_impossivel')
        }
        if (version.state !== 'submitted') {
          throw new JobNaoProcessavelError('estado_invalido')
        }

        const answers = parseAnswers(version.answersJson)
        if (!isReadyToSubmit(answers)) {
          // O `submitDraft` já barrou isso uma vez; chegar aqui incompleto significa que a
          // linha mudou por fora. Gerar em cima disso produziria configuração com buraco.
          throw new JobNaoProcessavelError('respostas_incompletas')
        }

        await tx.aiSetupEvent.create({
          data: {
            tenantId: candidato.tenantId,
            versionId: candidato.versionId,
            kind: 'job_started',
            actor: ATOR,
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
          answers,
          attempts: candidato.attempts + 1,
          claimToken,
        }
      }, opcoes),
    )
  } catch (error) {
    if (!(error instanceof JobNaoProcessavelError)) {
      throw error
    }
    // A transação foi revertida — o job voltou a `pending` e o token nunca existiu. Marcar
    // acontece fora, com CAS e evento próprios.
    await marcarJobNaoProcessavel(candidato, error.motivo, agora)
    return null
  }
}

/** Tira da fila um job que não pode ser processado, com registro. */
async function marcarJobNaoProcessavel(
  candidato: CandidatoDeJob,
  motivo: MotivoNaoProcessavel,
  agora: Date,
): Promise<void> {
  const { kind, codigo, alarmar, citarVersao } = classificar(motivo)

  const marcou = await comRetry((opcoes) =>
    db.$transaction(async (tx) => {
      const { count } = await tx.aiSetupJob.updateMany({
        where: { id: candidato.id, status: 'pending' },
        data: {
          status: 'failed',
          failureKind: kind,
          lastError: codigo,
          finishedAt: agora,
          claimToken: null,
          claimedAt: null,
        },
      })
      if (count !== 1) {
        return false
      }
      await tx.aiSetupEvent.create({
        data: {
          tenantId: candidato.tenantId,
          // Versão de outra empresa não entra na auditoria desta — ver `citarVersao`.
          versionId: citarVersao ? candidato.versionId : null,
          kind: 'job_failed',
          actor: ATOR,
          detail: JSON.stringify({ jobId: candidato.id, failureKind: kind, codigo, motivo }),
        },
      })
      return true
    }, opcoes),
  )

  if (marcou && alarmar) {
    void reportSetupIncident(`job ${candidato.id} não é processável (${motivo})`)
  }
}

// ── Lease ───────────────────────────────────────────────────────────────────────

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

// ── Transação final ─────────────────────────────────────────────────────────────

/** O que o job produz (§6.1). Tudo JSON serializado — o formato é assunto do processador. */
export type ArtefatosDoJob = {
  candidateConfigJson: string
  candidateKnowledgeJson: string
  summaryJson: string
  gapsJson: string
  risksJson: string
  validationJson: string
}

export type MotivoDaRecusa =
  /** O lease já era de outro: outro processo herdou o job. */
  | 'lease_perdido'
  /** A versão saiu de baixo: nova geração, ou já mudou de estado. */
  | 'versao_mudou'
  /** Publicaram enquanto o job rodava: a candidata nasceu sobre base velha (§4.8). */
  | 'base_mudou'

export type ResultadoFinal = { ok: true } | { ok: false; motivo: MotivoDaRecusa }

/** Aborta a transação final carregando o MOTIVO — sem variável mutável de fora. */
class FinalizacaoAbortada extends Error {
  constructor(readonly motivo: MotivoDaRecusa) {
    super(`finalização abortada: ${motivo}`)
    this.name = 'FinalizacaoAbortada'
  }
}

/**
 * A transação final: artefatos, estado da versão, conclusão do job e evento — TUDO junto.
 *
 * É uma transação só porque as quatro coisas são a mesma coisa. Gravar artefato e falhar
 * ao concluir deixaria o job voltando à fila para gerar de novo por cima do que já estava
 * lá; concluir sem evento deixaria a auditoria sem o desfecho justamente do passo que
 * produz a configuração que vai atender cliente.
 *
 * Tenant, versão e geração vêm do JOB, não do chamador (regra 1 do topo). Três guardas:
 * o LEASE, a VERSÃO (mesma geração e estado) e a BASE — se publicaram enquanto o job
 * rodava, a candidata foi construída sobre uma configuração que já não é a vigente.
 */
export async function finalizarJobComSucesso(input: {
  jobId: string
  claimToken: string
  artefatos: ArtefatosDoJob
  /** `needs_changes` quando o agente achou lacunas de negócio (§6.4); senão null. */
  proximoEstado: 'needs_changes' | null
  agora?: Date
}): Promise<ResultadoFinal> {
  const agora = input.agora ?? new Date()
  if (input.proximoEstado) {
    // A regra de transição é conferida ANTES de abrir a transação: se for inválida, isto é
    // bug de chamada e tem que estourar, não virar rollback silencioso.
    assertSetupTransition('submitted', input.proximoEstado, ATOR)
  }

  try {
    await comRetry((opcoes) =>
      db.$transaction(async (tx) => {
        const job = await tx.aiSetupJob.findFirst({
          where: { id: input.jobId, status: 'processing', claimToken: input.claimToken },
          select: { versionId: true, tenantId: true, generation: true },
        })
        if (!job) {
          throw new FinalizacaoAbortada('lease_perdido')
        }

        const versao = await tx.aiSetupVersion.findFirst({
          where: {
            id: job.versionId,
            tenantId: job.tenantId,
            generation: job.generation,
            state: 'submitted',
          },
          select: { setupId: true, basePublishedVersionId: true },
        })
        if (!versao) {
          throw new FinalizacaoAbortada('versao_mudou')
        }

        const setup = await tx.aiSetup.findUnique({
          where: { tenantId: job.tenantId },
          select: { id: true, publishedVersionId: true, reviewVersionId: true },
        })
        // As mesmas conferências do claim, DE NOVO: entre reivindicar e concluir passam
        // minutos, e nesse intervalo a versão pode ter deixado de ser a que o setup aponta.
        // Gravar artefato numa versão largada produz candidata que ninguém vai revisar.
        if (!setup || versao.setupId !== setup.id) {
          throw new FinalizacaoAbortada('versao_mudou')
        }
        if (setup.reviewVersionId !== job.versionId) {
          throw new FinalizacaoAbortada('versao_mudou')
        }
        if ((setup.publishedVersionId ?? null) !== versao.basePublishedVersionId) {
          // A base congelada no envio já não é a que está no ar: a candidata foi pensada
          // contra outra configuração e não pode ser gravada como se fosse atual.
          throw new FinalizacaoAbortada('base_mudou')
        }

        const escritaDaVersao = await tx.aiSetupVersion.updateMany({
          where: {
            id: job.versionId,
            tenantId: job.tenantId,
            generation: job.generation,
            state: 'submitted',
          },
          data: {
            ...input.artefatos,
            ...(input.proximoEstado ? { state: input.proximoEstado } : {}),
          },
        })
        if (escritaDaVersao.count !== 1) {
          throw new FinalizacaoAbortada('versao_mudou')
        }

        const escritaDoJob = await tx.aiSetupJob.updateMany({
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
        if (escritaDoJob.count !== 1) {
          throw new FinalizacaoAbortada('lease_perdido')
        }

        await tx.aiSetupEvent.create({
          data: {
            tenantId: job.tenantId,
            versionId: job.versionId,
            kind: 'job_completed',
            actor: ATOR,
            detail: JSON.stringify({
              jobId: input.jobId,
              generation: job.generation,
              proximoEstado: input.proximoEstado,
            }),
          },
        })
      }, opcoes),
    )
    return { ok: true }
  } catch (error) {
    if (error instanceof FinalizacaoAbortada) {
      return { ok: false, motivo: error.motivo }
    }
    // Esgotou a contenção com o trabalho PRONTO na mão: os artefatos não foram gravados e
    // o job volta à fila para gerar tudo de novo. É caro e é sinal de banco em sofrimento
    // — precisa de gente olhando.
    void reportSetupIncident(`não consegui gravar o resultado do job ${input.jobId}`)
    throw error
  }
}

// ── Falha ───────────────────────────────────────────────────────────────────────

export type ResultadoDaFalha = {
  status: 'retry_wait' | 'failed'
  alarmou: boolean
  /** Quando volta a ficar elegível (só em `retry_wait`). */
  proximaTentativaEm: Date | null
}

/**
 * Registra a falha e decide o destino do job.
 *
 * Tenant, versão e tentativas vêm do JOB (regra 1 do topo). As tentativas em especial:
 * quem processa pode ter perdido o lease sem saber, e decidir "esgotou" com um número
 * velho marcaria como definitivo um job que ainda tinha chance.
 *
 * O que vai para o banco é o CÓDIGO. O detalhe do erro só aparece no log, e só com
 * `NODE_ENV=development` E `SETUP_LOG_DETALHE=1` — ver `podeMostrarDetalhe`. Devolve
 * `null` quando o lease já não é nosso: nada foi escrito.
 */
export async function failSetupJob(input: {
  jobId: string
  claimToken: string
  kind: FailureKind
  codigo: CodigoErro
  /** Só para o log local, e só em desenvolvimento com opt-in. Nunca chega ao banco. */
  detalhe?: unknown
  agora?: Date
}): Promise<ResultadoDaFalha | null> {
  const agora = input.agora ?? new Date()
  const codigo = ehCodigoConhecido(input.codigo) ? input.codigo : 'erro_desconhecido'

  const resultado = await comRetry((opcoes) =>
    db.$transaction(async (tx) => {
      const job = await tx.aiSetupJob.findFirst({
        where: { id: input.jobId, status: 'processing', claimToken: input.claimToken },
        select: { attempts: true, versionId: true, tenantId: true },
      })
      if (!job) {
        return null
      }

      const desfecho = decidirDesfecho(input.kind, job.attempts)
      const proxima =
        desfecho.status === 'retry_wait' ? proximaTentativaEm(job.attempts, agora) : null

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
        return null
      }

      await tx.aiSetupEvent.create({
        data: {
          tenantId: job.tenantId,
          versionId: job.versionId,
          kind: 'job_failed',
          actor: ATOR,
          detail: JSON.stringify({
            jobId: input.jobId,
            failureKind: input.kind,
            codigo,
            attempt: job.attempts,
            status: desfecho.status,
          }),
        },
      })

      // O resultado sai daqui de dentro (regra 2 do topo): uma variável de fora
      // sobreviveria a um rollback e reportaria sucesso por escrita desfeita.
      return {
        status: desfecho.status,
        alarmar: desfecho.alarmar,
        proximaTentativaEm: proxima,
        attempts: job.attempts,
      }
    }, opcoes),
  )

  if (!resultado) {
    return null
  }

  logarFalha(input.jobId, input.kind, codigo, resultado.attempts, input.detalhe)
  if (resultado.alarmar) {
    void reportSetupIncident(`job ${input.jobId} falhou (${codigo})`)
  }
  return {
    status: resultado.status,
    alarmou: resultado.alarmar,
    proximaTentativaEm: resultado.proximaTentativaEm,
  }
}

const OPT_IN_DETALHE = 'SETUP_LOG_DETALHE'

/**
 * O detalhe do erro pode ir para o log?
 *
 * Só com as DUAS condições: ambiente de desenvolvimento declarado E a variável ligada na
 * mão. Nenhuma das duas sozinha basta, e cada uma cobre um buraco do outro desenho:
 *
 *  - só a variável não bastaria porque ela pode acabar ligada num `.env` que foi para
 *    produção, e aí o vazamento fica permanente e silencioso;
 *  - só o ambiente não bastaria porque os comandos assistidos rodam SEM `NODE_ENV`
 *    definido — `!== 'production'` é verdade ali, e o detalhe sairia justamente no
 *    caminho em que ele é usado.
 *
 * Exigir `=== 'development'` (e não "diferente de produção") fecha o caso do ambiente
 * ausente: na dúvida sobre onde se está rodando, não mostra.
 */
function podeMostrarDetalhe(): boolean {
  return process.env.NODE_ENV === 'development' && process.env[OPT_IN_DETALHE] === '1'
}

/**
 * Loga a falha. Por padrão sai SÓ o código.
 *
 * O detalhe é a mensagem do erro de um job de agentes: ela carrega pedaço do prompt e da
 * saída, ou seja, dado de cliente da empresa. O hermes.log fica no disco do Pi e vai junto
 * em qualquer cópia de diagnóstico — não é lugar para isso.
 */
function logarFalha(
  jobId: string,
  kind: FailureKind,
  codigo: CodigoErro,
  attempts: number,
  detalhe: unknown,
): void {
  const base = `[setup-queue] job ${jobId} falhou (${kind}/${codigo}, tentativa ${attempts})`
  if (!podeMostrarDetalhe() || detalhe === undefined) {
    console.error(base)
    return
  }
  console.error(`${base}: ${sanitizarErro(detalhe)}`)
}

// ── Faxinas ─────────────────────────────────────────────────────────────────────

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
  const esgotados = await encerrarEsgotados(agora)

  return { orfaos: orfaos.count, liberados: liberados.count, esgotados }
}

/**
 * Encerra os jobs sem tentativa sobrando, cada um com o seu evento.
 *
 * Um `updateMany` sozinho seria mais curto e deixaria a auditoria cega justamente no
 * desfecho que ninguém viu acontecer — é o único caminho em que o job morre sem nenhum
 * processo tendo olhado para ele.
 */
async function encerrarEsgotados(agora: Date): Promise<number> {
  const zumbis = await db.aiSetupJob.findMany({
    where: { status: 'pending', attempts: { gte: MAX_ATTEMPTS } },
    select: { id: true, tenantId: true, versionId: true, failureKind: true },
  })
  if (zumbis.length === 0) {
    return 0
  }

  let encerrados = 0
  for (const zumbi of zumbis) {
    // O último `failureKind` visto é o que descreve a morte (§6.4); sem nenhum, foi um
    // crash antes de qualquer desfecho registrado.
    const kind = zumbi.failureKind ?? 'transient'
    const marcou = await comRetry((opcoes) =>
      db.$transaction(async (tx) => {
        const { count } = await tx.aiSetupJob.updateMany({
          where: { id: zumbi.id, status: 'pending' },
          data: {
            status: 'failed',
            failureKind: kind,
            lastError: 'erro_desconhecido' satisfies CodigoErro,
            finishedAt: agora,
          },
        })
        if (count !== 1) {
          return false
        }
        await tx.aiSetupEvent.create({
          data: {
            tenantId: zumbi.tenantId,
            versionId: zumbi.versionId,
            kind: 'job_failed',
            actor: ATOR,
            detail: JSON.stringify({
              jobId: zumbi.id,
              failureKind: kind,
              codigo: 'erro_desconhecido',
              motivo: 'tentativas_esgotadas',
            }),
          },
        })
        return true
      }, opcoes),
    )
    if (marcou) {
      encerrados += 1
    }
  }

  if (encerrados > 0) {
    void reportSetupIncident(`${encerrados} job(s) esgotaram as tentativas`)
  }
  return encerrados
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
//
// E fora dos COMANDOS de terminal: eles importam este módulo para inspecionar a fila, e a
// varredura ESCREVE. Num `--sim`, que promete não alterar nada, um timer mexendo na fila
// pelas costas quebraria a promessa — e o comando morre antes dos 60 s de qualquer jeito,
// então o sweeper ali não serve para nada além de risco.
if (!process.env.VITEST && process.env.SETUP_SWEEPER_OFF !== '1') {
  startSetupJobSweeper()
}
