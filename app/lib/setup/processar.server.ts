// A orquestração de UMA passada do processamento assistido: pega um job, entrega ao
// processador, persiste o resultado.
//
// O processador é INJETADO. Não é preferência de estilo: é o que permite exercitar o
// caminho inteiro — inclusive as falhas — sem chamar o cérebro, que custa minutos por job
// e tem concorrência 1. Quem chama decide quem gera; aqui só se sabe o que fazer com o
// que voltou.
//
// Nada aqui reivindica sozinho. A função roda quando alguém a chama, e é isso que mantém
// o worker automático desligado (§6.2) sem depender de disciplina de quem edita o código.

import { type CodigoErro, type FailureKind, HEARTBEAT_INTERVAL_MS } from './job'
import type { ArtefatosDoJob, JobReivindicado, MotivoDaRecusa } from './job.server'
import {
  claimNextSetupJob,
  failSetupJob,
  finalizarJobComSucesso,
  heartbeatSetupJob,
} from './job.server'
import { ehContencaoTransitoria } from './retry'

/** O que o processador devolve quando o trabalho dá certo. */
export type ResultadoDoProcessador = {
  artefatos: ArtefatosDoJob
  /**
   * O agente encontrou lacunas de NEGÓCIO (faltou informação da empresa)?
   *
   * Isso não é falha do job: ele fez o trabalho e a conclusão é "faltou dado". A versão
   * volta para o cliente em `needs_changes` e o job termina `completed` (§6.4).
   */
  temLacunas: boolean
}

export type Processador = (job: JobReivindicado) => Promise<ResultadoDoProcessador>

/**
 * Falha que o processador sabe classificar.
 *
 * Qualquer outro erro é tratado como transitório — de propósito. Um job morto exige
 * trabalho manual para reviver, e o teto de três tentativas já limita o custo de insistir
 * à toa. Errar para o lado de tentar de novo é mais barato que errar para o lado de matar.
 */
export class FalhaDoProcessamento extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly codigo: CodigoErro,
    mensagem?: string,
  ) {
    super(mensagem ?? `processamento falhou: ${codigo}`)
    this.name = 'FalhaDoProcessamento'
  }
}

export type ResultadoDaPassada =
  /** A consulta voltou vazia: não há o que fazer agora. */
  | { tipo: 'nada_a_fazer' }
  /**
   * O teto de candidatos foi inspecionado e todos foram descartados. NÃO é fila vazia —
   * pode haver job válido logo atrás, e dizer "vazio" manda a pessoa embora com trabalho
   * pendente.
   */
  | { tipo: 'teto_atingido'; inspecionados: number }
  | { tipo: 'concluido'; jobId: string; versionId: string; tenantSlug: string; comLacunas: boolean }
  /** O job foi processado mas o resultado não pôde ser gravado (§4.8, lease perdido…). */
  | { tipo: 'recusado'; jobId: string; motivo: MotivoDaRecusa }
  | {
      tipo: 'falhou'
      jobId: string
      kind: FailureKind
      codigo: CodigoErro
      status: 'retry_wait' | 'failed'
    }
  /**
   * O trabalho ficou pronto e o banco não aceitou a gravação nem com insistência.
   *
   * `status` diz o que aconteceu com o LEASE depois disso, e a distinção importa:
   *
   *  - `retry_wait` / `failed`: deu para registrar a falha, o lease foi devolvido e o job
   *    volta pela fila normalmente;
   *  - `lease_perdido`: outro processo já tinha herdado o job;
   *  - `recuperacao_pendente`: o banco continuou travado e NEM a liberação passou. O job
   *    segue `processing` com o token. É a única resposta honesta — liberar o lease
   *    também é uma escrita, e prometer `retry_wait` quando nada pôde ser escrito seria
   *    inventar um estado que não existe no banco.
   */
  | {
      tipo: 'persistencia_falhou'
      jobId: string
      /**
       * ONDE a escrita falhou. As duas situações produzem o mesmo aperto no banco e
       * exigem mensagens diferentes:
       *
       *  - `gravar_artefatos`: o processador terminou, os artefatos ficaram prontos e é
       *    isso que se perdeu;
       *  - `registrar_falha_processamento`: o processador NÃO produziu nada, e o banco
       *    ainda por cima recusou registrar a falha. Dizer "o trabalho ficou pronto" aqui
       *    é mentira.
       */
      fase: 'gravar_artefatos' | 'registrar_falha_processamento'
      status: 'retry_wait' | 'failed' | 'lease_perdido' | 'recuperacao_pendente'
    }

/** Quantas vezes a GRAVAÇÃO é repetida. A geração nunca é refeita — ver `persistir`. */
const TENTATIVAS_DE_PERSISTENCIA = 3

export type OpcoesDaPassada = {
  processador: Processador
  /** Intervalo do heartbeat; os testes passam um valor curto ou desligam com `0`. */
  heartbeatMs?: number
  /** Espera entre tentativas de gravação. */
  esperaDaPersistenciaMs?: number
}

/**
 * Uma passada: reivindica, processa, persiste.
 *
 * Devolve um desfecho para tudo o que é ESPERADO — falha do processador, contenção do
 * banco, estado que mudou embaixo. Quem chama é um comando de terminal, e um stack trace
 * no lugar de um desfecho não ajuda ninguém a decidir o que fazer em seguida.
 *
 * O que NÃO é esperado sobe: erro de programação virando "banco ocupado" mandaria o
 * operador destravar um banco que nunca esteve travado.
 */
export async function processarProximoJob(opcoes: OpcoesDaPassada): Promise<ResultadoDaPassada> {
  const claim = await claimNextSetupJob()
  if (claim.tipo === 'empty') {
    return { tipo: 'nada_a_fazer' }
  }
  if (claim.tipo === 'limit_reached') {
    return { tipo: 'teto_atingido', inspecionados: claim.inspecionados }
  }

  const job = claim.job
  const pulsar = iniciarHeartbeat(job, opcoes.heartbeatMs ?? HEARTBEAT_INTERVAL_MS)

  try {
    let resultado: ResultadoDoProcessador
    try {
      resultado = await opcoes.processador(job)
    } catch (error) {
      return await registrarFalha(job, error)
    }

    const persistencia = await persistir(job, resultado, opcoes.esperaDaPersistenciaMs ?? 500)
    if (persistencia.tipo !== 'estourou') {
      return persistencia.resultado
    }

    // A gravação esgotou. A primeira escolha é devolver o job à fila — a taxonomia manda
    // `retry_wait` para contenção (§6.4), e deixá-lo `processing` empurraria a recuperação
    // para o sweeper, que só age 30 minutos depois. Isso é fallback de crash, não desfecho
    // de uma falha que o comando VIU acontecer.
    //
    // Mas devolver TAMBÉM é escrever. Se o banco continuar travado, esta chamada estoura
    // igual — e aí o único desfecho honesto é dizer que o job ficou protegido pelo lease e
    // que o sweeper o recupera quando ele vencer. Prometer `retry_wait` aqui seria inventar
    // um estado que não existe no banco, e o operador iria procurá-lo.
    return {
      tipo: 'persistencia_falhou',
      jobId: job.id,
      fase: 'gravar_artefatos',
      status: await liberarLeaseAposFalha(job, persistencia.erro),
    }
  } finally {
    pulsar()
  }
}

/**
 * Mantém o lease vivo enquanto o processador trabalha. Devolve a função que desliga.
 *
 * É best-effort de propósito: se o heartbeat falhar (perdemos o lease), quem impede a
 * escrita errada é o compare-and-swap da gravação, não este timer. Tentar abortar daqui
 * seria uma segunda fonte de verdade sobre quem é o dono do job.
 */
function iniciarHeartbeat(job: JobReivindicado, intervaloMs: number): () => void {
  if (intervaloMs <= 0) {
    return () => {}
  }
  const timer = setInterval(() => {
    void heartbeatSetupJob(job.id, job.claimToken).catch(() => {})
  }, intervaloMs)
  timer.unref()
  return () => clearInterval(timer)
}

/**
 * Tenta devolver o job à fila depois de a gravação esgotar.
 *
 * Nunca lança: o chamador precisa de um desfecho para contar, não de mais uma exceção em
 * cima de uma falha que ele já observou.
 */
async function liberarLeaseAposFalha(
  job: JobReivindicado,
  erro: unknown,
): Promise<'retry_wait' | 'failed' | 'lease_perdido' | 'recuperacao_pendente'> {
  try {
    const desfecho = await failSetupJob({
      jobId: job.id,
      claimToken: job.claimToken,
      kind: 'transient',
      codigo: 'banco_ocupado',
      detalhe: erro,
    })
    // `null` aqui é o CAS não casando: outro processo herdou o job. Diferente de "não
    // consegui escrever".
    return desfecho?.status ?? 'lease_perdido'
  } catch (error) {
    // SÓ contenção vira "recuperação pendente". Um `TypeError` caindo aqui viraria
    // diagnóstico de SQLite ocupado e mandaria o operador destravar um banco que nunca
    // esteve travado.
    if (!ehContencaoTransitoria(error)) {
      throw error
    }
    // O banco continua recusando escrita. Nada foi alterado, o token segue de pé e o
    // sweeper recupera quando o lease vencer.
    return 'recuperacao_pendente'
  }
}

/** Traduz o erro do processador em desfecho de fila. */
async function registrarFalha(job: JobReivindicado, error: unknown): Promise<ResultadoDaPassada> {
  const { kind, codigo } =
    error instanceof FalhaDoProcessamento
      ? { kind: error.kind, codigo: error.codigo }
      : ({ kind: 'transient', codigo: 'erro_desconhecido' } as const)

  let desfecho: Awaited<ReturnType<typeof failSetupJob>>
  try {
    desfecho = await failSetupJob({
      jobId: job.id,
      claimToken: job.claimToken,
      kind,
      codigo,
      detalhe: error,
    })
  } catch (erroDoBanco) {
    // Mesma regra do outro caminho: só contenção. Erro de programação sobe.
    if (!ehContencaoTransitoria(erroDoBanco)) {
      throw erroDoBanco
    }
    // Falhou o processamento E o banco não aceita nem o registro da falha. O job fica
    // protegido pelo lease até o sweeper recuperá-lo — mesma honestidade do caminho de
    // persistência: não se anuncia um estado que não foi gravado.
    return {
      tipo: 'persistencia_falhou',
      jobId: job.id,
      fase: 'registrar_falha_processamento',
      status: 'recuperacao_pendente',
    }
  }
  if (!desfecho) {
    // O lease já era de outro: outro processo herdou o job e vai gerar de novo. Nada a
    // registrar — insistir aqui sobrescreveria o trabalho dele.
    return { tipo: 'recusado', jobId: job.id, motivo: 'lease_perdido' }
  }
  return { tipo: 'falhou', jobId: job.id, kind, codigo, status: desfecho.status }
}

type Persistencia =
  | { tipo: 'resolvida'; resultado: ResultadoDaPassada }
  /** As tentativas acabaram. Quem chamou decide o desfecho do job — aqui não se escreve. */
  | { tipo: 'estourou'; erro: unknown }

/**
 * Grava o resultado, repetindo SÓ a gravação.
 *
 * Os artefatos já estão na mão quando esta função começa: uma falha de banco não pode
 * fazer o cérebro rodar de novo. Fora o custo (minutos por job, concorrência 1), a
 * segunda geração daria um texto diferente da primeira — e aí não dá para saber qual foi
 * o resultado revisado.
 */
async function persistir(
  job: JobReivindicado,
  resultado: ResultadoDoProcessador,
  esperaMs: number,
): Promise<Persistencia> {
  let ultimoErro: unknown
  for (let tentativa = 0; tentativa < TENTATIVAS_DE_PERSISTENCIA; tentativa += 1) {
    try {
      const final = await finalizarJobComSucesso({
        jobId: job.id,
        claimToken: job.claimToken,
        artefatos: resultado.artefatos,
        proximoEstado: resultado.temLacunas ? 'needs_changes' : null,
      })
      if (final.ok) {
        return {
          tipo: 'resolvida',
          resultado: {
            tipo: 'concluido',
            jobId: job.id,
            versionId: job.versionId,
            tenantSlug: job.tenantSlug,
            comLacunas: resultado.temLacunas,
          },
        }
      }
      // Recusa NÃO é erro de banco: o estado mudou embaixo e insistir daria o mesmo
      // resultado. Sai na hora.
      return {
        tipo: 'resolvida',
        resultado: { tipo: 'recusado', jobId: job.id, motivo: final.motivo },
      }
    } catch (error) {
      // Só CONTENÇÃO é repetida. Um `catch` vazio transformava bug de lógica em três
      // tentativas idênticas e depois num desfecho que diz "banco ocupado" — mentira que
      // mandaria alguém investigar o lugar errado.
      if (!ehContencaoTransitoria(error)) {
        throw error
      }
      ultimoErro = error
      if (tentativa < TENTATIVAS_DE_PERSISTENCIA - 1 && esperaMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, esperaMs * (tentativa + 1)))
      }
    }
  }
  return { tipo: 'estourou', erro: ultimoErro }
}
