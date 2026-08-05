import { db } from '../../db.server'
import {
  isReadyToSubmit,
  missingFieldsByStep,
  parseAnswers,
  type SetupAnswers,
  serializeAnswers,
} from './answers'
import { type ResolucaoAposPerda, resolverAposPerderCas } from './claim'
import { criarJobDeGeracao } from './job.server'
import { comRetry, ehContencaoTransitoria } from './retry'
import { assertSetupTransition, isSetupState } from './state'

// Leitura e escrita da versão de configuração em elaboração (spec §5.2, §3.2, §3.5).
// Server-side. A regra de completude vive em `answers.ts` e a de transição em `state.ts`,
// ambas puras — aqui só se aplica o que elas decidem, com as garantias que só o banco dá:
// compare-and-swap e transação.
//
// A FONTE DA VERDADE do que está em elaboração é `AiSetup.reviewVersionId`, nunca uma
// busca por estado. Procurar por `state in (draft, needs_changes)` parece equivalente e
// não é: depois de submeter, a versão sai desse conjunto, a busca não a encontra e um
// segundo rascunho nasce — trocando o ponteiro de review e fazendo a revisão interna
// olhar a versão errada.

/** O autosave (ou a transição) não encontrou a linha no estado/revisão esperados. */
export class StaleRevisionError extends Error {
  constructor(message = 'A versão mudou desde que esta tela foi carregada.') {
    super(message)
    this.name = 'StaleRevisionError'
  }
}

/** Faltam obrigatórios — o servidor recusa mesmo que a tela tenha deixado passar. */
export class SubmitNotReadyError extends Error {
  constructor(readonly missing: Record<string, string[]>) {
    super('Ainda faltam informações obrigatórias.')
    this.name = 'SubmitNotReadyError'
  }
}

/**
 * `reviewVersionId` aponta para uma versão que este tenant não tem. Estado corrompido:
 * é incidente operacional, não caso de uso — e por isso falha alto em vez de tentar se
 * curar sozinho.
 */
export class OrphanReviewPointerError extends Error {
  constructor(
    readonly tenantId: string,
    readonly danglingVersionId: string,
  ) {
    super(
      `AiSetup.reviewVersionId do tenant ${tenantId} aponta para a versão ${danglingVersionId}, que não existe para ele`,
    )
    this.name = 'OrphanReviewPointerError'
  }
}

/**
 * `publishedVersionId` aponta para algo que não é uma versão publicada DESTE tenant.
 *
 * A chave estrangeira só garante que o id existe em algum lugar da tabela — nada impede
 * que ele aponte para versão de outro tenant, de outro setup, ainda em rascunho ou sem
 * `publishedAt`. E o ponteiro publicado é o que decide se a tela diz "sua IA já está
 * configurada": aceitá-lo sem conferir é mentir sobre o que está no ar (INV-1, INV-12).
 */
export class OrphanPublishedPointerError extends Error {
  constructor(
    readonly tenantId: string,
    readonly danglingVersionId: string,
  ) {
    super(
      `AiSetup.publishedVersionId do tenant ${tenantId} aponta para a versão ${danglingVersionId}, que não é uma publicação válida dele`,
    )
    this.name = 'OrphanPublishedPointerError'
  }
}

/** Sinaliza que outra requisição tomou o ponteiro primeiro — a transação é desfeita. */
class PointerTakenError extends Error {
  constructor(readonly discardedVersionId: string) {
    super('reviewVersionId já foi tomado por outra requisição')
    this.name = 'PointerTakenError'
  }
}

/** A versão como as telas a enxergam — respostas já desserializadas. */
export type VersionView = {
  id: string
  state: string
  revision: number
  generation: number
  answers: SetupAnswers
  submittedAt: Date | null
  basePublishedVersionId: string | null
  /** O que nossa equipe pediu para corrigir, quando o estado é `needs_changes`. */
  reviewNote: string | null
}

type VersionRow = {
  id: string
  state: string
  revision: number
  generation: number
  answersJson: string
  submittedAt: Date | null
  basePublishedVersionId: string | null
  reviewNote: string | null
}

function toView(row: VersionRow): VersionView {
  return {
    id: row.id,
    state: row.state,
    revision: row.revision,
    generation: row.generation,
    answers: parseAnswers(row.answersJson),
    submittedAt: row.submittedAt,
    basePublishedVersionId: row.basePublishedVersionId,
    reviewNote: row.reviewNote,
  }
}

export type SetupWorkspace = {
  /** A versão em elaboração/revisão, ou null quando não há nada pendente. */
  version: VersionView | null
  /** O tenant já tem uma configuração publicada? */
  published: boolean
  /** Já foi ativado no WhatsApp alguma vez? */
  activated: boolean
}

/**
 * O que o tenant tem em elaboração. Devolve a versão apontada por `reviewVersionId`
 * qualquer que seja o estado dela — inclusive `submitted` e `ready_to_test`, que é o que
 * permite à tela mostrar "recebemos suas respostas" em vez de abrir outro questionário.
 *
 * Só cria rascunho no caso inicial: nenhuma review pendente E nada publicado ainda. Um
 * tenant já publicado que não tem revisão aberta devolve `version: null` — criar um
 * rascunho sozinho ali abriria um segundo onboarding sem ninguém pedir.
 */
export async function loadSetupWorkspace(tenantId: string): Promise<SetupWorkspace> {
  const setup = await db.aiSetup.findUnique({ where: { tenantId } })
  if (!setup) {
    throw new Error(`Tenant sem AiSetup: ${tenantId}`)
  }
  const base = {
    published: setup.publishedVersionId !== null,
    activated: setup.activatedAt !== null,
  }

  if (setup.reviewVersionId) {
    const atual = await buscarVersaoDoSetup(setup.reviewVersionId, tenantId, setup.id)
    if (atual) {
      // O ponteiro publicado é conferido AQUI TAMBÉM. Ter revisão pendente não torna o
      // outro ponteiro confiável: `published` vai para a tela e decide o que ela diz sobre
      // o que está no ar. Um ponteiro mentiroso não deixa de mentir por haver rascunho.
      return {
        published: await conferirPublicada(tenantId, setup),
        activated: base.activated,
        version: toView(atual),
      }
    }
    // Ponteiro órfão. NÃO seguir para a criação: o CAS exige `reviewVersionId: null`, então
    // ele jamais casaria, o `PointerTakenError` mandaria recarregar e a recarga acharia o
    // mesmo ponteiro órfão — laço infinito. Consertar por conta própria seria pior: não dá
    // para saber se a versão sumiu, mudou de dono ou nunca deveria estar apontada ali.
    throw new OrphanReviewPointerError(tenantId, setup.reviewVersionId)
  }

  if (base.published) {
    // Mesma conferência do caminho de recuperação: o ponteiro publicado é a base da
    // resposta "já está configurada", então ele é verificado nos dois lugares. Estados
    // corrompidos não podem depender de por qual caminho a requisição passou.
    return semRevisaoPendente(tenantId, setup)
  }

  assertSetupTransition(null, 'draft', 'system', { activated: base.activated })

  // Criação com CAS no ponteiro: duas requisições concorrentes (a pessoa clicando duas
  // vezes, ou duas abas abrindo juntas) não podem criar dois rascunhos órfãos.
  let criada: VersionRow
  try {
    criada = await comRetry((opcoes) =>
      db.$transaction(async (tx) => {
        const version = await tx.aiSetupVersion.create({
          data: {
            setupId: setup.id,
            tenantId,
            state: 'draft',
            origin: 'onboarding',
            answersJson: JSON.stringify({}),
          },
        })
        const claimed = await tx.aiSetup.updateMany({
          // Só toma o ponteiro se ele AINDA estiver livre E nada tiver sido publicado
          // no meio: uma publicação concorrente muda o caso de "inicial" para "já tem
          // configuração", e aí este rascunho não deveria existir.
          where: { id: setup.id, tenantId, reviewVersionId: null, publishedVersionId: null },
          data: { reviewVersionId: version.id },
        })
        if (claimed.count !== 1) {
          // Outra requisição ganhou a corrida. Desfaz a nossa e usa a dela.
          throw new PointerTakenError(version.id)
        }
        return version
      }, opcoes),
    )
  } catch (error) {
    if (error instanceof PointerTakenError) {
      // Perdemos a corrida no CAS. A transação foi revertida (o rascunho provisório não
      // existe) e o estado correto é o de quem venceu — outro rascunho OU uma publicação
      // que aconteceu no meio. `PointerTakenError` nunca vaza para o chamador.
      return resolverPerdaDoPonteiro(tenantId)
    }

    // Perder por CONTENÇÃO é o mesmo desfecho por outro caminho: no SQLite a escrita é
    // serializada entre TODOS os tenants, então sob carga uma das chamadas concorrentes
    // pode não conseguir nem começar a transação nas quatro tentativas. Desistir com o
    // P2028 na mão sem olhar o banco é errado — quem venceu já deixou o rascunho pronto,
    // e o que o chamador precisa é dele, não do erro.
    //
    // É seguro porque a transação que não começou não escreveu nada: ou ela commitou (e
    // aí `comRetry` teria voltado), ou foi revertida por inteiro.
    if (ehContencaoTransitoria(error)) {
      const vencedora = await tentarResolverAposContencao(tenantId)
      if (vencedora) {
        return vencedora
      }
    }
    throw error
  }

  return { ...base, version: toView(criada) }
}

/**
 * O que devolver quando a criação do rascunho perdeu a corrida pelo ponteiro.
 *
 * Relê o estado e aplica `resolverAposPerderCas` (puro, testado em claim.test.ts). NÃO
 * chama `loadSetupWorkspace` de volta: a recursão parecia inofensiva e não era — com um
 * ponteiro que o CAS jamais casaria, ela girava para sempre batendo no banco, com a
 * requisição pendurada até alguém desistir.
 */
async function resolverPerdaDoPonteiro(tenantId: string): Promise<SetupWorkspace> {
  const setup = await db.aiSetup.findUnique({ where: { tenantId } })
  if (!setup) {
    throw new Error(`Tenant sem AiSetup: ${tenantId}`)
  }

  const decisao = resolverAposPerderCas(setup)
  if (decisao.tipo === 'incoerente') {
    // O CAS exige os dois ponteiros nulos: perder com os dois ainda nulos significa que
    // não foi concorrência, e chutar um rascunho aqui esconderia o problema real.
    throw new Error(
      `Setup do tenant ${tenantId} perdeu o CAS de criação sem que ninguém tomasse o ponteiro`,
    )
  }
  return materializarResolucao(tenantId, setup, decisao)
}

/**
 * A mesma leitura, para o caso em que a tentativa morreu de contenção em vez de perder o
 * CAS. Devolve `null` — e não um erro — quando nada apareceu: aí quem manda é o erro
 * original, que descreve o que de fato aconteceu.
 */
async function tentarResolverAposContencao(tenantId: string): Promise<SetupWorkspace | null> {
  const setup = await db.aiSetup.findUnique({ where: { tenantId } })
  if (!setup) {
    return null
  }
  const decisao = resolverAposPerderCas(setup)
  if (decisao.tipo === 'incoerente') {
    return null
  }
  return materializarResolucao(tenantId, setup, decisao)
}

/** Transforma a decisão (pura) no workspace, buscando a versão vencedora quando é o caso. */
async function materializarResolucao(
  tenantId: string,
  setup: SetupRow,
  decisao: Exclude<ResolucaoAposPerda, { tipo: 'incoerente' }>,
): Promise<SetupWorkspace> {
  if (decisao.tipo === 'usar-publicada') {
    return semRevisaoPendente(tenantId, setup)
  }
  const vencedora = await buscarVersaoDoSetup(decisao.versionId, tenantId, setup.id)
  if (!vencedora) {
    throw new OrphanReviewPointerError(tenantId, decisao.versionId)
  }
  return {
    published: await conferirPublicada(tenantId, setup),
    activated: setup.activatedAt !== null,
    version: toView(vencedora),
  }
}

/**
 * Busca a versão exigindo tenant E setup.
 *
 * O `tenantId` sozinho não fecha: um tenant tem um `AiSetup`, mas nada no banco impede uma
 * linha com o `tenantId` certo e o `setupId` de outro. Deixar passar seria abrir a versão
 * de outra configuração como se fosse a deste onboarding (INV-12).
 */
function buscarVersaoDoSetup(versionId: string, tenantId: string, setupId: string) {
  return db.aiSetupVersion.findFirst({ where: { id: versionId, tenantId, setupId } })
}

/** O bastante do `AiSetup` para decidir e conferir os ponteiros. */
type SetupRow = {
  id: string
  publishedVersionId: string | null
  activatedAt: Date | null
}

/**
 * "Já tem configuração no ar e nada pendente" — a resposta que faz a tela dizer que a IA
 * está configurada e parar de oferecer questionário.
 *
 * Aqui o ponteiro publicado é CONFERIDO, não acreditado. A FK garante só que o id existe
 * em alguma linha da tabela; ela não impede que aponte para versão de outro tenant, de
 * outro setup, ainda em rascunho ou sem `publishedAt`. Qualquer um desses casos significa
 * que nada está de fato publicado, e responder "está tudo certo" seria a pior saída:
 * esconde corrupção justamente na pergunta que o cliente faz sobre o que está no ar.
 */
async function semRevisaoPendente(tenantId: string, setup: SetupRow): Promise<SetupWorkspace> {
  return {
    published: await conferirPublicada(tenantId, setup),
    activated: setup.activatedAt !== null,
    version: null,
  }
}

/**
 * Há publicação? Confere o ponteiro em vez de acreditar nele.
 *
 * A FK garante só que o id existe em alguma linha da tabela: nada impede que aponte para
 * versão de outro tenant, de outro setup, ainda em rascunho ou sem `publishedAt`. Como o
 * valor devolvido vira `published` na tela — a resposta à pergunta "o que está no ar?" —,
 * um ponteiro que não bate é incidente, não um `false` silencioso.
 */
async function conferirPublicada(tenantId: string, setup: SetupRow): Promise<boolean> {
  if (!setup.publishedVersionId) {
    return false
  }
  const publicada = await db.aiSetupVersion.findFirst({
    where: {
      id: setup.publishedVersionId,
      tenantId,
      setupId: setup.id,
      // INV-1: publicada vive em `active` ou `customer_approved` E tem `publishedAt`.
      state: { in: ['active', 'customer_approved'] },
      publishedAt: { not: null },
    },
    select: { id: true },
  })
  if (!publicada) {
    throw new OrphanPublishedPointerError(tenantId, setup.publishedVersionId)
  }
  return true
}

/**
 * Grava as respostas com compare-and-swap na revisão (spec §5.2). Duas abas abertas não se
 * sobrescrevem em silêncio: a atrasada recebe `StaleRevisionError`.
 *
 * O `where` carrega TODAS as pré-condições — tenant, estado e revisão —, então uma versão
 * de outro tenant ou já submetida simplesmente não casa.
 */
export async function saveDraftAnswers(input: {
  versionId: string
  tenantId: string
  answers: SetupAnswers
  expectedRevision: number
}): Promise<VersionView> {
  const answersJson = serializeAnswers(input.answers)

  const claimed = await db.aiSetupVersion.updateMany({
    where: {
      id: input.versionId,
      tenantId: input.tenantId,
      state: 'draft',
      revision: input.expectedRevision,
    },
    data: { answersJson, revision: { increment: 1 } },
  })
  if (claimed.count !== 1) {
    throw new StaleRevisionError()
  }

  const atualizada = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: input.versionId } })
  return toView(atualizada)
}

/**
 * Reabre uma versão que voltou com pedido de correção (`needs_changes → draft`, §3.5).
 *
 * A limpeza é obrigatória, não higiene: sem ela, os artefatos e as marcações de validação
 * do ciclo anterior sobreviveriam e a próxima revisão julgaria material velho. As RESPOSTAS
 * permanecem — são o trabalho do cliente — e `changesRequested` acumula de propósito.
 */
export async function reopenForChanges(input: {
  versionId: string
  tenantId: string
  expectedRevision: number
}): Promise<VersionView> {
  const version = await db.aiSetupVersion.findFirst({
    where: { id: input.versionId, tenantId: input.tenantId },
  })
  if (!version || !isSetupState(version.state)) {
    throw new StaleRevisionError('Versão não encontrada para este tenant.')
  }
  assertSetupTransition(version.state, 'draft', 'owner')

  const claimed = await db.aiSetupVersion.updateMany({
    where: {
      id: input.versionId,
      tenantId: input.tenantId,
      state: 'needs_changes',
      revision: input.expectedRevision,
    },
    data: {
      state: 'draft',
      revision: { increment: 1 },
      candidateConfigJson: null,
      candidateKnowledgeJson: null,
      summaryJson: null,
      gapsJson: null,
      risksJson: null,
      validationJson: null,
      validationResultsJson: null,
      approvedByAccountId: null,
      approvedAt: null,
      reviewStartedAt: null,
      reviewCompletedAt: null,
      reviewer: null,
      reviewNote: null,
    },
  })
  if (claimed.count !== 1) {
    throw new StaleRevisionError()
  }

  const reaberta = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: input.versionId } })
  return toView(reaberta)
}

/**
 * Envia o rascunho para revisão: congela as respostas, incrementa a geração, grava a
 * versão-base do momento e enfileira o job — tudo numa transação.
 *
 * `expectedRevision` também aqui: se alguém editou entre carregar a tela e clicar em
 * enviar, o que seria submetido não é o que a pessoa leu.
 *
 * O job é criado, mas ninguém o processa automaticamente — o worker é desligado por
 * padrão (§6.2) e o processamento é assistido por comando.
 */
export async function submitDraft(input: {
  versionId: string
  tenantId: string
  accountId: string
  expectedRevision: number
}): Promise<VersionView> {
  const version = await db.aiSetupVersion.findFirst({
    where: { id: input.versionId, tenantId: input.tenantId },
  })
  if (!version || !isSetupState(version.state)) {
    throw new StaleRevisionError('Versão não encontrada para este tenant.')
  }
  if (version.revision !== input.expectedRevision) {
    throw new StaleRevisionError()
  }

  const answers = parseAnswers(version.answersJson)
  if (!isReadyToSubmit(answers)) {
    throw new SubmitNotReadyError(missingFieldsByStep(answers))
  }

  const setup = await db.aiSetup.findUnique({ where: { tenantId: input.tenantId } })
  if (!setup) {
    throw new StaleRevisionError('Tenant sem AiSetup.')
  }
  assertSetupTransition(version.state, 'submitted', 'owner', {
    activated: setup.activatedAt !== null,
  })

  const generation = version.generation + 1
  const agora = new Date()

  await comRetry((opcoes) =>
    db.$transaction(async (tx) => {
      // A base é lida DENTRO da transação: se uma publicação acontecer entre a leitura
      // acima e este ponto, gravar a base velha faria a candidata nascer obsoleta.
      const atual = await tx.aiSetup.findUniqueOrThrow({ where: { tenantId: input.tenantId } })

      const claimed = await tx.aiSetupVersion.updateMany({
        where: {
          id: version.id,
          tenantId: input.tenantId,
          state: version.state,
          revision: input.expectedRevision,
        },
        data: {
          state: 'submitted',
          submittedAt: agora,
          generation,
          revision: { increment: 1 },
          basePublishedVersionId: atual.publishedVersionId,
          reviewStartedAt: null,
          reviewCompletedAt: null,
          reviewer: null,
          reviewNote: null,
        },
      })
      if (claimed.count !== 1) {
        throw new StaleRevisionError('A versão mudou de estado durante o envio.')
      }

      // A criação do job vive na fila (job.server.ts): o formato da chave de idempotência
      // é assunto dela, e importar daqui é o que carrega o módulo — e portanto liga o
      // sweeper das faxinas — no boot do servidor.
      await criarJobDeGeracao(tx, {
        versionId: version.id,
        tenantId: input.tenantId,
        generation,
      })

      await tx.aiSetupEvent.create({
        data: {
          tenantId: input.tenantId,
          versionId: version.id,
          kind: 'submitted',
          // Auditoria precisa dizer QUEM enviou, não só "um cliente".
          actor: `customer:${input.accountId}`,
          detail: JSON.stringify({ generation }),
        },
      })
    }, opcoes),
  )

  const submetida = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: version.id } })
  return toView(submetida)
}
