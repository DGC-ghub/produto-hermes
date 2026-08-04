import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db.server'

// O que acontece quando a criação do rascunho não perde o CAS — perde a CONTENÇÃO.
//
// No SQLite a escrita é serializada entre TODOS os tenants, então sob carga (a suíte
// inteira, ou webhook + telas em produção) uma de várias chamadas concorrentes pode não
// conseguir nem começar a transação nas quatro tentativas. Desistir ali com o P2028 na mão
// é errado quando outra chamada JÁ deixou o rascunho pronto: o chamador precisa dele, não
// do erro. Foi assim que a suíte canônica falhou em `duas chamadas concorrentes`.
//
// Arquivo separado porque `comRetry` é mockado no módulo inteiro. O mock substitui só a
// insistência — a classificação (`ehContencaoTransitoria`) continua sendo a de verdade,
// senão o teste provaria a forma do código em vez do comportamento.

const controle = vi.hoisted(() => ({
  /** Roda "durante" a contenção: é onde o teste simula a chamada que venceu. */
  duranteAContencao: null as null | (() => Promise<void>),
}))

vi.mock('./retry', async (importOriginal) => {
  const real = await importOriginal<typeof import('./retry')>()
  return {
    ...real,
    // Esgota sempre: representa as quatro tentativas terminando em contenção.
    comRetry: async () => {
      if (controle.duranteAContencao) {
        await controle.duranteAContencao()
      }
      throw Object.assign(new Error('Transaction API error: Operation has timed out'), {
        code: 'P2028',
      })
    },
  }
})

const { loadSetupWorkspace, OrphanPublishedPointerError, OrphanReviewPointerError } = await import(
  './version.server'
)

let tenantId: string
let setupId: string

beforeEach(async () => {
  controle.duranteAContencao = null
  const tenant = await db.tenant.create({
    data: { slug: `contencao-${crypto.randomUUID().slice(0, 8)}`, name: 'Tenant de teste' },
  })
  tenantId = tenant.id
  setupId = (await db.aiSetup.create({ data: { tenantId } })).id
})

describe('contenção esgotada: olhar o banco antes de desistir', () => {
  it('outra chamada já tomou o ponteiro → devolve a versão vencedora, sem propagar P2028', async () => {
    controle.duranteAContencao = async () => {
      const vencedora = await db.aiSetupVersion.create({
        data: { setupId, tenantId, state: 'draft', origin: 'onboarding', answersJson: '{}' },
      })
      await db.aiSetup.update({
        where: { id: setupId },
        data: { reviewVersionId: vencedora.id },
      })
    }

    const workspace = await loadSetupWorkspace(tenantId)

    expect(workspace.version).not.toBeNull()
    expect(workspace.version?.state).toBe('draft')

    // Uma só: a tentativa que morreu de contenção não chegou a escrever nada.
    expect(await db.aiSetupVersion.count({ where: { tenantId } })).toBe(1)

    const ponteiro = await db.aiSetup.findUniqueOrThrow({ where: { id: setupId } })
    expect(ponteiro.reviewVersionId).toBe(workspace.version?.id)
  })

  it('uma publicação apareceu no meio → devolve publicado, sem rascunho', async () => {
    controle.duranteAContencao = async () => {
      const publicada = await db.aiSetupVersion.create({
        data: { setupId, tenantId, state: 'active', answersJson: '{}', publishedAt: new Date() },
      })
      await db.aiSetup.update({
        where: { id: setupId },
        data: { publishedVersionId: publicada.id },
      })
    }

    const workspace = await loadSetupWorkspace(tenantId)

    expect(workspace.published).toBe(true)
    expect(workspace.version).toBeNull()
    expect(await db.aiSetupVersion.count({ where: { tenantId, state: 'draft' } })).toBe(0)
  })

  it('ponteiro de review CORROMPIDO no meio → erro do ponteiro, não o P2028', async () => {
    // Corrupção de ponteiro é o diagnóstico mais preciso que existe para este estado, e
    // continua fail-closed: devolver o P2028 aqui mandaria procurar contenção, que não é
    // o problema.
    controle.duranteAContencao = async () => {
      const outro = await db.tenant.create({
        data: { slug: `alheio-${crypto.randomUUID().slice(0, 8)}`, name: 'Outro' },
      })
      const outroSetup = await db.aiSetup.create({ data: { tenantId: outro.id } })
      const alheia = await db.aiSetupVersion.create({
        data: { setupId: outroSetup.id, tenantId: outro.id, state: 'draft', answersJson: '{}' },
      })
      await db.aiSetup.update({ where: { id: setupId }, data: { reviewVersionId: alheia.id } })
    }

    await expect(loadSetupWorkspace(tenantId)).rejects.toBeInstanceOf(OrphanReviewPointerError)
  })

  it('ponteiro de PUBLICAÇÃO inválido no meio → erro do ponteiro, não "está publicado"', async () => {
    controle.duranteAContencao = async () => {
      // Rascunho apontado como publicação: a FK aceita, o invariante não (INV-1).
      const rascunho = await db.aiSetupVersion.create({
        data: { setupId, tenantId, state: 'draft', answersJson: '{}' },
      })
      await db.aiSetup.update({
        where: { id: setupId },
        data: { publishedVersionId: rascunho.id },
      })
    }

    await expect(loadSetupWorkspace(tenantId)).rejects.toBeInstanceOf(OrphanPublishedPointerError)
  })

  it('NINGUÉM venceu → propaga o P2028 original, sem inventar rascunho', async () => {
    // O negativo é o que impede a recuperação de virar um "engole erro": se o banco não
    // mostra vencedor, o que houve foi contenção mesmo, e quem chamou precisa saber.
    await expect(loadSetupWorkspace(tenantId)).rejects.toMatchObject({ code: 'P2028' })

    expect(await db.aiSetupVersion.count({ where: { tenantId } })).toBe(0)
    const ponteiro = await db.aiSetup.findUniqueOrThrow({ where: { id: setupId } })
    expect(ponteiro.reviewVersionId).toBeNull()
  })
})
