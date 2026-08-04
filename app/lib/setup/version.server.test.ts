import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db.server'
import {
  getOrCreateDraft,
  StaleRevisionError,
  SubmitNotReadyError,
  saveDraftAnswers,
  submitDraft,
} from './version.server'

// Integração com o banco de teste (descartável, ver vitest.global-setup.ts). O CAS do
// autosave e a atomicidade da submissão dependem do comportamento REAL do updateMany —
// mockar o banco aqui provaria a forma da query, não a garantia.
//
// Referência: spec §5.2 (autosave com compare-and-swap) e §3.2 (draft → submitted).

let tenantId: string
let setupId: string

/** Respostas completas o bastante para submeter. */
async function respostasCompletas(): Promise<Record<string, string | string[]>> {
  const { SETUP_FIELDS } = await import('./answers')
  const answers: Record<string, string | string[]> = {}
  for (const field of SETUP_FIELDS) {
    answers[field.key] =
      field.kind === 'list' ? ['um item bem descritivo'] : 'resposta com folga acima do mínimo'
  }
  return answers
}

beforeEach(async () => {
  const slug = `setup-test-${crypto.randomUUID().slice(0, 8)}`
  const tenant = await db.tenant.create({ data: { slug, name: 'Tenant de teste' } })
  tenantId = tenant.id
  const setup = await db.aiSetup.create({ data: { tenantId } })
  setupId = setup.id
})

describe('getOrCreateDraft', () => {
  it('cria o rascunho na primeira vez', async () => {
    const draft = await getOrCreateDraft(tenantId)
    expect(draft.state).toBe('draft')
    expect(draft.revision).toBe(0)
    expect(draft.generation).toBe(0)
    expect(draft.answers).toEqual({})
  })

  it('devolve o mesmo rascunho na segunda chamada — não cria dois', async () => {
    const a = await getOrCreateDraft(tenantId)
    const b = await getOrCreateDraft(tenantId)
    expect(b.id).toBe(a.id)
    expect(await db.aiSetupVersion.count({ where: { tenantId } })).toBe(1)
  })

  it('aponta reviewVersionId para o rascunho', async () => {
    const draft = await getOrCreateDraft(tenantId)
    const setup = await db.aiSetup.findUnique({ where: { id: setupId } })
    expect(setup?.reviewVersionId).toBe(draft.id)
  })
})

describe('autosave com compare-and-swap (spec §5.2)', () => {
  it('grava e incrementa a revisão', async () => {
    const draft = await getOrCreateDraft(tenantId)
    const salvo = await saveDraftAnswers({
      versionId: draft.id,
      tenantId,
      answers: { nome: 'Clínica Bem Estar do bairro' },
      expectedRevision: 0,
    })
    expect(salvo.revision).toBe(1)
    expect(salvo.answers.nome).toBe('Clínica Bem Estar do bairro')
  })

  it('a aba antiga é RECUSADA em vez de sobrescrever a nova', async () => {
    // O cenário que "o servidor devolve o gravado" não resolvia: duas abas abertas,
    // a antiga salva por cima do que a nova acabou de escrever.
    const draft = await getOrCreateDraft(tenantId)
    await saveDraftAnswers({
      versionId: draft.id,
      tenantId,
      answers: { nome: 'gravado pela aba NOVA' },
      expectedRevision: 0,
    })

    await expect(
      saveDraftAnswers({
        versionId: draft.id,
        tenantId,
        answers: { nome: 'gravado pela aba ANTIGA' },
        expectedRevision: 0, // a antiga ainda acha que está na revisão 0
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError)

    const atual = await db.aiSetupVersion.findUnique({ where: { id: draft.id } })
    expect(atual?.answersJson).toContain('aba NOVA')
  })

  it('salvamentos em sequência avançam a revisão', async () => {
    const draft = await getOrCreateDraft(tenantId)
    let revision = 0
    for (const nome of ['primeira versão do nome', 'segunda versão do nome']) {
      const salvo = await saveDraftAnswers({
        versionId: draft.id,
        tenantId,
        answers: { nome },
        expectedRevision: revision,
      })
      revision = salvo.revision
    }
    expect(revision).toBe(2)
  })

  it('não grava em versão de OUTRO tenant', async () => {
    const draft = await getOrCreateDraft(tenantId)
    const outro = await db.tenant.create({
      data: { slug: `outro-${crypto.randomUUID().slice(0, 8)}`, name: 'Outro' },
    })

    await expect(
      saveDraftAnswers({
        versionId: draft.id,
        tenantId: outro.id, // tenant errado
        answers: { nome: 'invasão' },
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError)
  })

  it('não grava fora do estado draft (INV-2)', async () => {
    const draft = await getOrCreateDraft(tenantId)
    await db.aiSetupVersion.update({ where: { id: draft.id }, data: { state: 'submitted' } })

    await expect(
      saveDraftAnswers({
        versionId: draft.id,
        tenantId,
        answers: { nome: 'depois de submetido' },
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError)
  })

  it('descarta chave desconhecida antes de gravar', async () => {
    const draft = await getOrCreateDraft(tenantId)
    const salvo = await saveDraftAnswers({
      versionId: draft.id,
      tenantId,
      answers: { nome: 'nome bom o suficiente', invasor: 'x' } as Record<string, string>,
      expectedRevision: 0,
    })
    expect(salvo.answers).not.toHaveProperty('invasor')
  })
})

describe('submissão (draft → submitted)', () => {
  it('recusa enquanto faltar obrigatório — e diz o que falta', async () => {
    const draft = await getOrCreateDraft(tenantId)
    await saveDraftAnswers({
      versionId: draft.id,
      tenantId,
      answers: { nome: 'só o nome preenchido aqui' },
      expectedRevision: 0,
    })

    await expect(submitDraft({ versionId: draft.id, tenantId })).rejects.toBeInstanceOf(
      SubmitNotReadyError,
    )

    const intacta = await db.aiSetupVersion.findUnique({ where: { id: draft.id } })
    expect(intacta?.state).toBe('draft')
    expect(await db.aiSetupJob.count({ where: { tenantId } })).toBe(0)
  })

  it('com tudo preenchido: muda o estado, congela e cria o job', async () => {
    const draft = await getOrCreateDraft(tenantId)
    const salvo = await saveDraftAnswers({
      versionId: draft.id,
      tenantId,
      answers: await respostasCompletas(),
      expectedRevision: 0,
    })

    const submetida = await submitDraft({ versionId: draft.id, tenantId })

    expect(submetida.state).toBe('submitted')
    expect(submetida.generation).toBe(1) // incrementa a cada draft → submitted (§3.5)
    expect(submetida.submittedAt).not.toBeNull()
    expect(salvo.revision).toBe(1)

    const job = await db.aiSetupJob.findFirst({ where: { tenantId } })
    expect(job?.status).toBe('pending')
    expect(job?.generation).toBe(1)
    expect(job?.idempotencyKey).toContain(draft.id)
  })

  it('grava basePublishedVersionId com a publicada do momento', async () => {
    // Primeira configuração não tem base — o campo fica nulo, e é isso que a publicação
    // vai exigir que continue batendo (INV-13).
    const draft = await getOrCreateDraft(tenantId)
    await saveDraftAnswers({
      versionId: draft.id,
      tenantId,
      answers: await respostasCompletas(),
      expectedRevision: 0,
    })
    const submetida = await submitDraft({ versionId: draft.id, tenantId })
    expect(submetida.basePublishedVersionId).toBeNull()
  })

  it('dois cliques em "enviar" não criam dois jobs', async () => {
    const draft = await getOrCreateDraft(tenantId)
    await saveDraftAnswers({
      versionId: draft.id,
      tenantId,
      answers: await respostasCompletas(),
      expectedRevision: 0,
    })

    await submitDraft({ versionId: draft.id, tenantId })
    // O segundo clique não encontra mais um draft: a transição é recusada.
    await expect(submitDraft({ versionId: draft.id, tenantId })).rejects.toBeTruthy()

    expect(await db.aiSetupJob.count({ where: { tenantId } })).toBe(1)
  })

  it('registra o evento de submissão na auditoria', async () => {
    const draft = await getOrCreateDraft(tenantId)
    await saveDraftAnswers({
      versionId: draft.id,
      tenantId,
      answers: await respostasCompletas(),
      expectedRevision: 0,
    })
    await submitDraft({ versionId: draft.id, tenantId })

    const evento = await db.aiSetupEvent.findFirst({ where: { tenantId, kind: 'submitted' } })
    expect(evento).not.toBeNull()
    expect(evento?.versionId).toBe(draft.id)
  })

  it('não submete versão de outro tenant', async () => {
    const draft = await getOrCreateDraft(tenantId)
    await saveDraftAnswers({
      versionId: draft.id,
      tenantId,
      answers: await respostasCompletas(),
      expectedRevision: 0,
    })
    const outro = await db.tenant.create({
      data: { slug: `outro-${crypto.randomUUID().slice(0, 8)}`, name: 'Outro' },
    })

    await expect(submitDraft({ versionId: draft.id, tenantId: outro.id })).rejects.toBeTruthy()

    const intacta = await db.aiSetupVersion.findUnique({ where: { id: draft.id } })
    expect(intacta?.state).toBe('draft')
  })
})
