import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db.server'
import {
  loadSetupWorkspace,
  OrphanPublishedPointerError,
  OrphanReviewPointerError,
  reopenForChanges,
  StaleRevisionError,
  SubmitNotReadyError,
  saveDraftAnswers,
  submitDraft,
} from './version.server'

// Integração com o banco de teste (descartável, ver vitest.global-setup.ts). O CAS do
// autosave, a atomicidade da submissão e a criação concorrente do rascunho dependem do
// comportamento REAL do updateMany — mockar o banco aqui provaria a forma da query, não a
// garantia.
//
// Referência: spec §5.2 (autosave com CAS), §3.2 e §3.5 (transições e ciclos).

let tenantId: string
let setupId: string
const ACCOUNT_ID = 'acc-de-teste'

async function respostasCompletas(): Promise<Record<string, string | string[]>> {
  const { SETUP_FIELDS } = await import('./answers')
  const answers: Record<string, string | string[]> = {}
  for (const field of SETUP_FIELDS) {
    answers[field.key] =
      field.kind === 'list' ? ['um item bem descritivo'] : 'resposta com folga acima do mínimo'
  }
  return answers
}

/** Cria rascunho, preenche tudo e submete. Devolve a versão submetida. */
async function submeterTudo() {
  const { version } = await loadSetupWorkspace(tenantId)
  if (!version) {
    throw new Error('esperava um rascunho')
  }
  const salvo = await saveDraftAnswers({
    versionId: version.id,
    tenantId,
    answers: await respostasCompletas(),
    expectedRevision: version.revision,
  })
  return submitDraft({
    versionId: version.id,
    tenantId,
    accountId: ACCOUNT_ID,
    expectedRevision: salvo.revision,
  })
}

beforeEach(async () => {
  const slug = `setup-test-${crypto.randomUUID().slice(0, 8)}`
  const tenant = await db.tenant.create({ data: { slug, name: 'Tenant de teste' } })
  tenantId = tenant.id
  const setup = await db.aiSetup.create({ data: { tenantId } })
  setupId = setup.id
})

describe('loadSetupWorkspace — reviewVersionId é a fonte da verdade', () => {
  it('cria o rascunho na primeira vez', async () => {
    const { version } = await loadSetupWorkspace(tenantId)
    expect(version?.state).toBe('draft')
    expect(version?.revision).toBe(0)
    expect(version?.generation).toBe(0)
    expect(version?.answers).toEqual({})
  })

  it('devolve o mesmo rascunho na segunda chamada — não cria dois', async () => {
    const a = await loadSetupWorkspace(tenantId)
    const b = await loadSetupWorkspace(tenantId)
    expect(b.version?.id).toBe(a.version?.id)
    expect(await db.aiSetupVersion.count({ where: { tenantId } })).toBe(1)
  })

  it('aponta reviewVersionId para o rascunho', async () => {
    const { version } = await loadSetupWorkspace(tenantId)
    const setup = await db.aiSetup.findUnique({ where: { id: setupId } })
    expect(setup?.reviewVersionId).toBe(version?.id)
  })

  // ── O P0: depois de submeter, o loader roda de novo ─────────────────────
  it('DEPOIS DE SUBMETER devolve a MESMA versão, sem criar outro rascunho', async () => {
    // A rota revalida o loader logo após o POST. Se `loadSetupWorkspace` procurasse só por
    // draft/needs_changes, não acharia a versão submetida, criaria outra e trocaria o
    // ponteiro de review — a tela de "recebemos" nunca apareceria, e a revisão interna
    // olharia a versão errada.
    const submetida = await submeterTudo()

    const depois = await loadSetupWorkspace(tenantId)

    expect(depois.version?.id).toBe(submetida.id)
    expect(depois.version?.state).toBe('submitted')
    expect(await db.aiSetupVersion.count({ where: { tenantId } })).toBe(1)

    const setup = await db.aiSetup.findUnique({ where: { id: setupId } })
    expect(setup?.reviewVersionId).toBe(submetida.id)
  })

  it('chamar o loader várias vezes após submeter continua não criando rascunho', async () => {
    await submeterTudo()
    for (let i = 0; i < 3; i += 1) {
      await loadSetupWorkspace(tenantId)
    }
    expect(await db.aiSetupVersion.count({ where: { tenantId } })).toBe(1)
  })

  it('em needs_changes devolve a versão, sem reabrir sozinho', async () => {
    const submetida = await submeterTudo()
    await db.aiSetupVersion.update({
      where: { id: submetida.id },
      data: { state: 'needs_changes', reviewNote: 'faltou o horário' },
    })

    const { version } = await loadSetupWorkspace(tenantId)

    expect(version?.id).toBe(submetida.id)
    expect(version?.state).toBe('needs_changes')
    expect(version?.reviewNote).toBe('faltou o horário')
    expect(await db.aiSetupVersion.count({ where: { tenantId } })).toBe(1)
  })

  it('em ready_to_test devolve a versão sem criar rascunho', async () => {
    const submetida = await submeterTudo()
    await db.aiSetupVersion.update({
      where: { id: submetida.id },
      data: { state: 'ready_to_test' },
    })

    const { version } = await loadSetupWorkspace(tenantId)

    expect(version?.state).toBe('ready_to_test')
    expect(await db.aiSetupVersion.count({ where: { tenantId } })).toBe(1)
  })

  it('tenant já publicado e sem review pendente NÃO ganha rascunho automático', async () => {
    // Criar rascunho sozinho aqui abriria um segundo onboarding sem ninguém pedir.
    const version = await db.aiSetupVersion.create({
      data: {
        setupId,
        tenantId,
        state: 'active',
        answersJson: '{}',
        publishedAt: new Date(),
      },
    })
    await db.aiSetup.update({
      where: { id: setupId },
      data: { publishedVersionId: version.id, activatedAt: new Date(), reviewVersionId: null },
    })

    const workspace = await loadSetupWorkspace(tenantId)

    expect(workspace.version).toBeNull()
    expect(await db.aiSetupVersion.count({ where: { tenantId, state: 'draft' } })).toBe(0)
  })

  it('duas chamadas concorrentes não criam dois rascunhos', async () => {
    const [a, b, c] = await Promise.all([
      loadSetupWorkspace(tenantId),
      loadSetupWorkspace(tenantId),
      loadSetupWorkspace(tenantId),
    ])
    expect(await db.aiSetupVersion.count({ where: { tenantId } })).toBe(1)
    expect(new Set([a.version?.id, b.version?.id, c.version?.id]).size).toBe(1)
  })
})

describe('reopenForChanges (needs_changes → draft, spec §3.5)', () => {
  it('limpa artefatos, marcações e a nota da revisão anterior', async () => {
    const submetida = await submeterTudo()
    await db.aiSetupVersion.update({
      where: { id: submetida.id },
      data: {
        state: 'needs_changes',
        candidateConfigJson: '{"antigo":true}',
        candidateKnowledgeJson: '[]',
        summaryJson: '{}',
        gapsJson: '[]',
        risksJson: '[]',
        validationJson: '[]',
        validationResultsJson: '[]',
        approvedByAccountId: 'alguem',
        approvedAt: new Date(),
        reviewStartedAt: new Date(),
        reviewCompletedAt: new Date(),
        reviewer: 'revisor',
        reviewNote: 'faltou o horário',
        changesRequested: 1,
      },
    })

    const atual = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: submetida.id } })
    const reaberta = await reopenForChanges({
      versionId: submetida.id,
      tenantId,
      expectedRevision: atual.revision,
    })

    expect(reaberta.state).toBe('draft')
    const row = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: submetida.id } })
    for (const campo of [
      'candidateConfigJson',
      'candidateKnowledgeJson',
      'summaryJson',
      'gapsJson',
      'risksJson',
      'validationJson',
      'validationResultsJson',
      'approvedByAccountId',
      'approvedAt',
      'reviewStartedAt',
      'reviewCompletedAt',
      'reviewer',
      'reviewNote',
    ] as const) {
      expect(row[campo]).toBeNull()
    }
    // As respostas permanecem: é o trabalho do cliente.
    expect(row.answersJson).toContain('resposta com folga')
    // O contador de correções acumula entre ciclos, de propósito.
    expect(row.changesRequested).toBe(1)
  })

  it('não reabre a partir de um estado que não seja needs_changes', async () => {
    const { version } = await loadSetupWorkspace(tenantId)
    if (!version) {
      throw new Error('esperava rascunho')
    }
    await expect(
      reopenForChanges({ versionId: version.id, tenantId, expectedRevision: version.revision }),
    ).rejects.toBeTruthy()
  })
})

describe('autosave com compare-and-swap (spec §5.2)', () => {
  it('grava e incrementa a revisão', async () => {
    const { version } = await loadSetupWorkspace(tenantId)
    const salvo = await saveDraftAnswers({
      versionId: version?.id ?? '',
      tenantId,
      answers: { nome: 'Clínica Bem Estar do bairro' },
      expectedRevision: 0,
    })
    expect(salvo.revision).toBe(1)
    expect(salvo.answers.nome).toBe('Clínica Bem Estar do bairro')
  })

  it('a aba antiga é RECUSADA em vez de sobrescrever a nova', async () => {
    const { version } = await loadSetupWorkspace(tenantId)
    const id = version?.id ?? ''
    await saveDraftAnswers({
      versionId: id,
      tenantId,
      answers: { nome: 'gravado pela aba NOVA' },
      expectedRevision: 0,
    })

    await expect(
      saveDraftAnswers({
        versionId: id,
        tenantId,
        answers: { nome: 'gravado pela aba ANTIGA' },
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError)

    const atual = await db.aiSetupVersion.findUnique({ where: { id } })
    expect(atual?.answersJson).toContain('aba NOVA')
  })

  it('não grava em versão de OUTRO tenant', async () => {
    const { version } = await loadSetupWorkspace(tenantId)
    const outro = await db.tenant.create({
      data: { slug: `outro-${crypto.randomUUID().slice(0, 8)}`, name: 'Outro' },
    })

    await expect(
      saveDraftAnswers({
        versionId: version?.id ?? '',
        tenantId: outro.id,
        answers: { nome: 'invasão' },
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError)
  })

  it('não grava fora do estado draft (INV-2)', async () => {
    const { version } = await loadSetupWorkspace(tenantId)
    const id = version?.id ?? ''
    await db.aiSetupVersion.update({ where: { id }, data: { state: 'submitted' } })

    await expect(
      saveDraftAnswers({ versionId: id, tenantId, answers: { nome: 'x' }, expectedRevision: 0 }),
    ).rejects.toBeInstanceOf(StaleRevisionError)
  })

  it('descarta chave desconhecida antes de gravar', async () => {
    const { version } = await loadSetupWorkspace(tenantId)
    const salvo = await saveDraftAnswers({
      versionId: version?.id ?? '',
      tenantId,
      answers: { nome: 'nome bom o suficiente', invasor: 'x' } as Record<string, string>,
      expectedRevision: 0,
    })
    expect(salvo.answers).not.toHaveProperty('invasor')
  })
})

describe('submissão (draft → submitted)', () => {
  it('recusa enquanto faltar obrigatório — e diz o que falta', async () => {
    const { version } = await loadSetupWorkspace(tenantId)
    const id = version?.id ?? ''
    const salvo = await saveDraftAnswers({
      versionId: id,
      tenantId,
      answers: { nome: 'só o nome preenchido aqui' },
      expectedRevision: 0,
    })

    await expect(
      submitDraft({
        versionId: id,
        tenantId,
        accountId: ACCOUNT_ID,
        expectedRevision: salvo.revision,
      }),
    ).rejects.toBeInstanceOf(SubmitNotReadyError)

    const intacta = await db.aiSetupVersion.findUnique({ where: { id } })
    expect(intacta?.state).toBe('draft')
    expect(await db.aiSetupJob.count({ where: { tenantId } })).toBe(0)
  })

  it('com tudo preenchido: muda o estado, congela e cria o job', async () => {
    const submetida = await submeterTudo()

    expect(submetida.state).toBe('submitted')
    expect(submetida.generation).toBe(1)
    expect(submetida.submittedAt).not.toBeNull()

    const job = await db.aiSetupJob.findFirst({ where: { tenantId } })
    expect(job?.status).toBe('pending')
    expect(job?.generation).toBe(1)
    expect(job?.idempotencyKey).toContain(submetida.id)
  })

  it('a submissão também exige a revisão esperada (CAS)', async () => {
    // Se alguém editou entre carregar a tela e clicar em enviar, o que seria submetido
    // não é o que a pessoa leu.
    const { version } = await loadSetupWorkspace(tenantId)
    const id = version?.id ?? ''
    const salvo = await saveDraftAnswers({
      versionId: id,
      tenantId,
      answers: await respostasCompletas(),
      expectedRevision: 0,
    })

    await expect(
      submitDraft({
        versionId: id,
        tenantId,
        accountId: ACCOUNT_ID,
        expectedRevision: salvo.revision - 1, // revisão velha
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError)

    const intacta = await db.aiSetupVersion.findUnique({ where: { id } })
    expect(intacta?.state).toBe('draft')
    expect(await db.aiSetupJob.count({ where: { tenantId } })).toBe(0)
  })

  it('grava basePublishedVersionId com a publicada do momento', async () => {
    const submetida = await submeterTudo()
    expect(submetida.basePublishedVersionId).toBeNull()
  })

  it('dois cliques em "enviar" não criam dois jobs', async () => {
    const submetida = await submeterTudo()
    await expect(
      submitDraft({
        versionId: submetida.id,
        tenantId,
        accountId: ACCOUNT_ID,
        expectedRevision: submetida.revision,
      }),
    ).rejects.toBeTruthy()

    expect(await db.aiSetupJob.count({ where: { tenantId } })).toBe(1)
  })

  it('registra o evento com a conta que enviou', async () => {
    const submetida = await submeterTudo()

    const evento = await db.aiSetupEvent.findFirst({ where: { tenantId, kind: 'submitted' } })
    expect(evento?.versionId).toBe(submetida.id)
    // Auditoria precisa dizer QUEM, não só "um cliente" (spec §2.5).
    expect(evento?.actor).toBe(`customer:${ACCOUNT_ID}`)
  })

  it('não submete versão de outro tenant', async () => {
    const { version } = await loadSetupWorkspace(tenantId)
    const id = version?.id ?? ''
    const salvo = await saveDraftAnswers({
      versionId: id,
      tenantId,
      answers: await respostasCompletas(),
      expectedRevision: 0,
    })
    const outro = await db.tenant.create({
      data: { slug: `outro-${crypto.randomUUID().slice(0, 8)}`, name: 'Outro' },
    })

    await expect(
      submitDraft({
        versionId: id,
        tenantId: outro.id,
        accountId: ACCOUNT_ID,
        expectedRevision: salvo.revision,
      }),
    ).rejects.toBeTruthy()

    const intacta = await db.aiSetupVersion.findUnique({ where: { id } })
    expect(intacta?.state).toBe('draft')
  })
})

describe('estado do ponteiro (caminhos que não criam rascunho)', () => {
  // A decisão de "quem venceu a corrida" é pura e está testada em claim.test.ts. Aqui
  // ficam os caminhos que dependem do banco de verdade.

  it('ponteiro órfão falha explicitamente em vez de girar para sempre', async () => {
    // O ponteiro tem chave estrangeira, então ele não fica apontando para o nada — mas
    // FICA apontando para a versão de OUTRO tenant, que é órfã do ponto de vista deste
    // (a busca casa `id` E `tenantId`). Aí o caminho antigo era: cai na criação, o CAS
    // exige `reviewVersionId: null` e nunca casa, o `PointerTakenError` manda recarregar,
    // a recarga acha o mesmo ponteiro órfão — laço infinito batendo no banco, com a
    // requisição pendurada. Consertar sozinho seria pior: não dá para saber se a versão
    // sumiu, mudou de dono ou nunca deveria estar ali.
    const outro = await db.tenant.create({
      data: { slug: `orfao-${crypto.randomUUID().slice(0, 8)}`, name: 'Outro' },
    })
    const outroSetup = await db.aiSetup.create({ data: { tenantId: outro.id } })
    const versaoAlheia = await db.aiSetupVersion.create({
      data: { setupId: outroSetup.id, tenantId: outro.id, state: 'draft', answersJson: '{}' },
    })
    await db.aiSetup.update({
      where: { id: setupId },
      data: { reviewVersionId: versaoAlheia.id },
    })

    await expect(loadSetupWorkspace(tenantId)).rejects.toBeInstanceOf(OrphanReviewPointerError)

    // E não sobrou rascunho nenhum de tentativa perdida.
    expect(await db.aiSetupVersion.count({ where: { tenantId } })).toBe(0)
  })

  describe('o ponteiro publicado é CONFERIDO, não acreditado', () => {
    // A chave estrangeira garante só que o id existe em alguma linha da tabela. Ela não
    // impede apontar para versão de outro tenant, de outro setup, ainda em rascunho ou sem
    // `publishedAt` — e é esse ponteiro que faz a tela dizer "sua IA já está configurada".
    // Aceitá-lo sem conferir é mentir sobre o que está no ar (INV-1, INV-12).

    /** Aponta `publishedVersionId` para a versão dada e carrega o workspace. */
    async function apontarPublicadaPara(versionId: string) {
      await db.aiSetup.update({
        where: { id: setupId },
        data: { publishedVersionId: versionId },
      })
      return loadSetupWorkspace(tenantId)
    }

    it('publicação válida do mesmo tenant e setup: devolve publicado', async () => {
      const publicada = await db.aiSetupVersion.create({
        data: { setupId, tenantId, state: 'active', answersJson: '{}', publishedAt: new Date() },
      })

      const workspace = await apontarPublicadaPara(publicada.id)

      expect(workspace.published).toBe(true)
      expect(workspace.version).toBeNull()
    })

    it('customer_approved também vale (INV-1)', async () => {
      const publicada = await db.aiSetupVersion.create({
        data: {
          setupId,
          tenantId,
          state: 'customer_approved',
          answersJson: '{}',
          publishedAt: new Date(),
        },
      })

      expect((await apontarPublicadaPara(publicada.id)).published).toBe(true)
    })

    it('apontando versão de OUTRO tenant: erro explícito (INV-12)', async () => {
      const outro = await db.tenant.create({
        data: { slug: `pub-${crypto.randomUUID().slice(0, 8)}`, name: 'Outro' },
      })
      const outroSetup = await db.aiSetup.create({ data: { tenantId: outro.id } })
      const alheia = await db.aiSetupVersion.create({
        data: {
          setupId: outroSetup.id,
          tenantId: outro.id,
          state: 'active',
          answersJson: '{}',
          publishedAt: new Date(),
        },
      })

      await expect(apontarPublicadaPara(alheia.id)).rejects.toBeInstanceOf(
        OrphanPublishedPointerError,
      )
    })

    it('apontando um RASCUNHO: erro explícito (INV-1)', async () => {
      const rascunho = await db.aiSetupVersion.create({
        data: { setupId, tenantId, state: 'draft', answersJson: '{}', publishedAt: new Date() },
      })

      await expect(apontarPublicadaPara(rascunho.id)).rejects.toBeInstanceOf(
        OrphanPublishedPointerError,
      )
    })

    it('apontando versão SEM publishedAt: erro explícito (INV-1)', async () => {
      const semData = await db.aiSetupVersion.create({
        data: { setupId, tenantId, state: 'active', answersJson: '{}' },
      })

      await expect(apontarPublicadaPara(semData.id)).rejects.toBeInstanceOf(
        OrphanPublishedPointerError,
      )
    })
  })

  it('tenant já publicado nem chega ao CAS — devolve null antes de criar rascunho', async () => {
    const publicada = await db.aiSetupVersion.create({
      data: { setupId, tenantId, state: 'active', answersJson: '{}', publishedAt: new Date() },
    })
    await db.aiSetup.update({
      where: { id: setupId },
      data: { publishedVersionId: publicada.id },
    })

    const workspace = await loadSetupWorkspace(tenantId)

    // Retorno antecipado: nem chega ao CAS de criação.
    expect(workspace.published).toBe(true)
    expect(workspace.version).toBeNull()
    expect(await db.aiSetupVersion.count({ where: { tenantId, state: 'draft' } })).toBe(0)
  })
})
