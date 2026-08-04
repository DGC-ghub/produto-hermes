import { db } from '../../db.server'
import {
  isReadyToSubmit,
  missingFieldsByStep,
  parseAnswers,
  type SetupAnswers,
  serializeAnswers,
} from './answers'
import { comRetry } from './retry'
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

// Gancho SÓ para teste: roda entre criar o rascunho provisório e tentar tomar o ponteiro.
// É a única forma de exercitar o caminho PERDEDOR do CAS de forma determinística.
//
// Recebe a própria transação porque o SQLite não permite que outra conexão escreva
// enquanto esta transação está aberta — uma escrita "de fora" simplesmente não persiste.
// O teste então altera o estado por dentro, o que produz exatamente a condição que
// importa: o `updateMany` do ponteiro não casa.
// Mesmo padrão de `__setMakeSocket` em channels/baileys.server.ts.
type TxLike = Parameters<Parameters<typeof db.$transaction>[0]>[0]
let aoAntesDeTomarPonteiro: ((tx: TxLike) => Promise<void>) | null = null

/** @internal Apenas para teste. */
export function __setAntesDeTomarPonteiro(fn: ((tx: TxLike) => Promise<void>) | null): void {
  aoAntesDeTomarPonteiro = fn
}

/** Sinaliza que outra requisição tomou o ponteiro primeiro — a transação é desfeita. */
class PointerTakenError extends Error {
  constructor(readonly discardedVersionId: string) {
    super('reviewVersionId já foi tomado por outra requisição')
    this.name = 'PointerTakenError'
  }
}

/**
 * Re-tenta uma transação em erro transitório de lock. O SQLite serializa escritas: sob
 * concorrência (webhook + tela em produção; workers de teste no mesmo arquivo) uma
 * transação pode voltar com "database is locked" mesmo com busy_timeout configurado.
 *
 * Só é seguro porque todo corpo aqui é protegido por compare-and-swap: uma tentativa que
 * falhou não escreveu nada, e se a anterior tiver vencido a corrida o CAS da seguinte não
 * casa — em vez de duplicar, o erro vira `StaleRevisionError`, que é a verdade.
 *
 * Mesmo padrão de `provisionTenant` (provisioning.server.ts).
 */
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
    const atual = await db.aiSetupVersion.findFirst({
      where: { id: setup.reviewVersionId, tenantId },
    })
    if (atual) {
      return { ...base, version: toView(atual) }
    }
    // Ponteiro órfão (não deveria acontecer): segue para o caminho de criação.
  }

  if (base.published) {
    return { ...base, version: null }
  }

  assertSetupTransition(null, 'draft', 'system', { activated: base.activated })

  // Criação com CAS no ponteiro: duas requisições concorrentes (a pessoa clicando duas
  // vezes, ou duas abas abrindo juntas) não podem criar dois rascunhos órfãos.
  const criada = await comRetry(() =>
    db.$transaction(
      async (tx) => {
        const version = await tx.aiSetupVersion.create({
          data: {
            setupId: setup.id,
            tenantId,
            state: 'draft',
            origin: 'onboarding',
            answersJson: JSON.stringify({}),
          },
        })
        if (aoAntesDeTomarPonteiro) {
          await aoAntesDeTomarPonteiro(tx)
        }
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
      },
      { maxWait: 20_000, timeout: 20_000 },
    ),
  ).catch(async (error) => {
    if (!(error instanceof PointerTakenError)) {
      throw error
    }
    // Perdemos a corrida. A transação foi revertida (o rascunho provisório não existe), e
    // o estado correto é o de quem venceu — que pode ser outro rascunho OU uma publicação
    // que aconteceu no meio. `PointerTakenError` nunca vaza para o chamador.
    return null
  })

  if (criada === null) {
    return loadSetupWorkspace(tenantId)
  }

  return { ...base, version: toView(criada) }
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

  await comRetry(() =>
    db.$transaction(
      async (tx) => {
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

        await tx.aiSetupJob.create({
          data: {
            versionId: version.id,
            tenantId: input.tenantId,
            kind: 'generate',
            generation,
            idempotencyKey: `${version.id}:${generation}:generate:1`,
          },
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
      },
      { maxWait: 20_000, timeout: 20_000 },
    ),
  )

  const submetida = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: version.id } })
  return toView(submetida)
}
