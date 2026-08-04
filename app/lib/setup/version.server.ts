import { db } from '../../db.server'
import {
  isReadyToSubmit,
  missingFieldsByStep,
  parseAnswers,
  type SetupAnswers,
  serializeAnswers,
} from './answers'
import { assertSetupTransition } from './state'

// Leitura e escrita da versão de configuração em elaboração (spec §5.2, §3.2).
// Server-side: usa o banco. A regra de completude vive em `answers.ts` (pura) e a de
// transição em `state.ts` (pura) — aqui só se aplica o que elas decidem, com as garantias
// que só o banco pode dar: compare-and-swap e transação.

/** O autosave (ou a transição) não encontrou a linha no estado esperado. */
export class StaleRevisionError extends Error {
  constructor(message = 'A versão mudou desde que esta tela foi carregada.') {
    super(message)
    this.name = 'StaleRevisionError'
  }
}

/** Faltam obrigatórios — o servidor recusa a submissão mesmo que a tela tenha deixado passar. */
export class SubmitNotReadyError extends Error {
  constructor(readonly missing: Record<string, string[]>) {
    super('Ainda faltam informações obrigatórias.')
    this.name = 'SubmitNotReadyError'
  }
}

export type DraftView = {
  id: string
  state: string
  revision: number
  generation: number
  answers: SetupAnswers
  submittedAt: Date | null
  basePublishedVersionId: string | null
}

function toView(row: {
  id: string
  state: string
  revision: number
  generation: number
  answersJson: string
  submittedAt: Date | null
  basePublishedVersionId: string | null
}): DraftView {
  return {
    id: row.id,
    state: row.state,
    revision: row.revision,
    generation: row.generation,
    answers: parseAnswers(row.answersJson),
    submittedAt: row.submittedAt,
    basePublishedVersionId: row.basePublishedVersionId,
  }
}

/**
 * O rascunho em elaboração do tenant, criando-o se ainda não houver. Idempotente: chamar
 * duas vezes devolve a mesma linha, e não deixa dois rascunhos abertos (INV-3).
 */
export async function getOrCreateDraft(tenantId: string): Promise<DraftView> {
  const setup = await db.aiSetup.findUnique({ where: { tenantId } })
  if (!setup) {
    throw new Error(`Tenant sem AiSetup: ${tenantId}`)
  }

  const existente = await db.aiSetupVersion.findFirst({
    where: { tenantId, setupId: setup.id, state: { in: ['draft', 'needs_changes'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (existente) {
    return toView(existente)
  }

  // Nasce por transição de sistema — a mesma regra que o provisionamento usa.
  assertSetupTransition(null, 'draft', 'system', { activated: setup.activatedAt !== null })

  const criada = await db.$transaction(
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
      // O ponteiro de review é o que a tela e a revisão interna procuram.
      await tx.aiSetup.update({
        where: { id: setup.id },
        data: { reviewVersionId: version.id },
      })
      return version
    },
    { maxWait: 20_000, timeout: 20_000 },
  )
  return toView(criada)
}

/**
 * Grava as respostas com compare-and-swap na revisão (spec §5.2). Duas abas abertas não
 * se sobrescrevem em silêncio: a que estiver atrasada recebe `StaleRevisionError` e a tela
 * pede recarga.
 *
 * O `where` carrega TODAS as pré-condições — tenant, estado e revisão —, então uma versão
 * de outro tenant ou já submetida simplesmente não casa.
 */
export async function saveDraftAnswers(input: {
  versionId: string
  tenantId: string
  answers: SetupAnswers
  expectedRevision: number
}): Promise<DraftView> {
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
 * Envia o rascunho para revisão: congela as respostas, incrementa a geração, grava a
 * versão-base do momento e enfileira o job de geração — tudo numa transação.
 *
 * A geração isola o ciclo de correção (§3.5): sem ela, a candidata reprovada e a corrigida
 * compartilhariam a conversa do simulador e as marcações de validação.
 *
 * O job é criado aqui, mas ninguém o processa automaticamente: o worker é desligado por
 * padrão (§6.2), e o processamento é assistido por comando.
 */
export async function submitDraft(input: {
  versionId: string
  tenantId: string
}): Promise<DraftView> {
  const version = await db.aiSetupVersion.findFirst({
    where: { id: input.versionId, tenantId: input.tenantId },
  })
  if (!version) {
    throw new StaleRevisionError('Versão não encontrada para este tenant.')
  }

  const answers = parseAnswers(version.answersJson)
  if (!isReadyToSubmit(answers)) {
    throw new SubmitNotReadyError(missingFieldsByStep(answers))
  }

  const setup = await db.aiSetup.findUnique({ where: { tenantId: input.tenantId } })
  if (!setup) {
    throw new StaleRevisionError('Tenant sem AiSetup.')
  }

  // A regra pura decide se a transição existe; o CAS abaixo garante que ela aconteça uma
  // vez só, mesmo com dois cliques simultâneos.
  assertSetupTransition(version.state as 'draft' | 'needs_changes', 'submitted', 'owner', {
    activated: setup.activatedAt !== null,
  })

  const generation = version.generation + 1
  const agora = new Date()

  await db.$transaction(
    async (tx) => {
      const claimed = await tx.aiSetupVersion.updateMany({
        where: { id: version.id, tenantId: input.tenantId, state: version.state },
        data: {
          state: 'submitted',
          submittedAt: agora,
          generation,
          // A base é a publicada NESTE momento: se ela mudar antes da publicação, a
          // candidata fica obsoleta e não pode sobrescrever a alteração nova (INV-13).
          basePublishedVersionId: setup.publishedVersionId,
          // Ciclo novo: a revisão anterior não se aplica mais.
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
          // Dedup: dois cliques em "enviar" não enfileiram dois jobs.
          idempotencyKey: `${version.id}:${generation}:generate:1`,
        },
      })

      await tx.aiSetupEvent.create({
        data: {
          tenantId: input.tenantId,
          versionId: version.id,
          kind: 'submitted',
          actor: 'customer',
          detail: JSON.stringify({ generation }),
        },
      })
    },
    { maxWait: 20_000, timeout: 20_000 },
  )

  const submetida = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: version.id } })
  return toView(submetida)
}
