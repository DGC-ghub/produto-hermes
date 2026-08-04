import { redirect } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetupAnswers } from '../lib/setup/answers'

// A rota do questionário. O que estes testes prendem: o tenant vem da SESSÃO, o versionId
// do formulário é conferido e não usado como autoridade, e uma aba atrasada é recusada em
// vez de sobrescrever (spec §5.2). O POST também revalida a completude — quem manda um
// POST direto não passa pela tela (spec §5.1).

const OPERATOR = {
  accountId: 'acc-1',
  username: 'dono@acme.com',
  role: 'owner',
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
}

let authFails = false
let draft: {
  id: string
  state: string
  revision: number
  generation: number
  answers: SetupAnswers
  submittedAt: Date | null
  basePublishedVersionId: string | null
  reviewNote: string | null
}

vi.mock('../lib/auth.server', () => ({
  requireOwner: vi.fn(async () => {
    if (authFails) {
      throw redirect('/login?redirectTo=%2Fpreparar-ia')
    }
    return OPERATOR
  }),
}))

const loadSetupWorkspace = vi.fn(async () => ({
  version: draft,
  published: false,
  activated: false,
}))
const saveDraftAnswers = vi.fn(async (input: { expectedRevision: number }) => ({
  ...draft,
  revision: input.expectedRevision + 1,
}))
const submitDraft = vi.fn(async () => ({ ...draft, state: 'submitted' }))
const reopenForChanges = vi.fn(async () => ({ ...draft, state: 'draft' }))

vi.mock('../lib/setup/version.server', async () => {
  const real = await vi.importActual<typeof import('../lib/setup/version.server')>(
    '../lib/setup/version.server',
  )
  return {
    StaleRevisionError: real.StaleRevisionError,
    SubmitNotReadyError: real.SubmitNotReadyError,
    loadSetupWorkspace: (...args: unknown[]) => loadSetupWorkspace(...(args as [])),
    reopenForChanges: (...args: unknown[]) => reopenForChanges(...(args as [])),
    saveDraftAnswers: (...args: unknown[]) =>
      saveDraftAnswers(...(args as [{ expectedRevision: number }])),
    submitDraft: (...args: unknown[]) => submitDraft(...(args as [])),
  }
})

import { StaleRevisionError, SubmitNotReadyError } from '../lib/setup/version.server'
import { action, loader } from './preparar-ia'

function chamarLoader(url = 'https://h/preparar-ia') {
  return loader({ request: new Request(url) } as Parameters<typeof loader>[0])
}

/** Desembrulha o retorno de `data()`: { status, body }. Conflito precisa ser 409 de verdade. */
function desembrulhar(result: unknown): { status: number; body: Record<string, unknown> } {
  const wrapped = result as { data?: unknown; init?: { status?: number } }
  if (wrapped && typeof wrapped === 'object' && 'data' in wrapped) {
    return {
      status: wrapped.init?.status ?? 200,
      body: (wrapped.data ?? {}) as Record<string, unknown>,
    }
  }
  return { status: 200, body: (result ?? {}) as Record<string, unknown> }
}

function chamarAction(campos: Record<string, string>) {
  const body = new FormData()
  for (const [k, v] of Object.entries(campos)) {
    body.append(k, v)
  }
  return action({
    request: new Request('https://h/preparar-ia', { method: 'POST', body }),
  } as Parameters<typeof action>[0])
}

beforeEach(() => {
  vi.clearAllMocks()
  authFails = false
  draft = {
    id: 'ver-1',
    state: 'draft',
    revision: 3,
    generation: 0,
    answers: { nome: 'Clínica Bem Estar do bairro' },
    submittedAt: null,
    basePublishedVersionId: null,
    reviewNote: null,
  }
})

describe('portão', () => {
  it('sem sessão de dono, redireciona para o login', async () => {
    authFails = true
    await expect(chamarLoader()).rejects.toMatchObject({ status: 302 })
    await expect(chamarAction({ intent: 'salvar' })).rejects.toMatchObject({ status: 302 })
  })

  it('o rascunho é buscado pelo tenant da SESSÃO', async () => {
    await chamarLoader()
    expect(loadSetupWorkspace).toHaveBeenCalledWith(OPERATOR.tenantId)
  })
})

describe('loader', () => {
  it('devolve a etapa pedida na URL', async () => {
    const data = await chamarLoader('https://h/preparar-ia?etapa=seguranca')
    expect(data.step).toBe('seguranca')
  })

  it('etapa desconhecida cai na primeira, sem erro', async () => {
    for (const url of ['?etapa=invasao', '?etapa=', '']) {
      const data = await chamarLoader(`https://h/preparar-ia${url}`)
      expect(data.step).toBe('empresa')
    }
  })

  it('expõe progresso e o que falta', async () => {
    const data = await chamarLoader()
    expect(data.progress).toEqual({ done: 0, total: 4 })
    expect(data.missing.empresa.length).toBeGreaterThan(0)
  })
})

describe('autosave', () => {
  it('salva a etapa com a revisão esperada', async () => {
    const result = await chamarAction({
      intent: 'salvar',
      versionId: 'ver-1',
      revision: '3',
      step: 'empresa',
      nome: 'Clínica Bem Estar do bairro',
    })
    expect(saveDraftAnswers).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: 'ver-1', tenantId: 'tenant-1', expectedRevision: 3 }),
    )
    expect(result).toMatchObject({ ok: true, revision: 4 })
  })

  it('converte campo de lista em uma entrada por linha', async () => {
    await chamarAction({
      intent: 'salvar',
      versionId: 'ver-1',
      revision: '3',
      step: 'servicos',
      servicosOferecidos: 'conserto de geladeira\n  \ninstalação de ar',
    })
    const enviado = saveDraftAnswers.mock.calls[0][0] as unknown as { answers: SetupAnswers }
    expect(enviado.answers.servicosOferecidos).toEqual([
      'conserto de geladeira',
      'instalação de ar',
    ])
  })

  it('versionId do formulário que não bate com o do banco é RECUSADO', async () => {
    // O id do formulário é um palpite: quem manda outro não escreve na versão alheia.
    const result = await chamarAction({
      intent: 'salvar',
      versionId: 'ver-de-outro-tenant',
      revision: '3',
      step: 'empresa',
    })
    expect(saveDraftAnswers).not.toHaveBeenCalled()
    const { status, body } = desembrulhar(result)
    expect(status).toBe(409)
    expect(body).toMatchObject({ ok: false, stale: true })
  })

  it('revisão ausente ou inválida não salva', async () => {
    for (const revision of ['', 'abc']) {
      vi.clearAllMocks()
      const result = await chamarAction({
        intent: 'salvar',
        versionId: 'ver-1',
        revision,
        step: 'empresa',
      })
      expect(saveDraftAnswers).not.toHaveBeenCalled()
      const { status, body } = desembrulhar(result)
      expect(status).toBe(409)
      expect(body).toMatchObject({ ok: false, stale: true })
    }
  })

  it('conflito de revisão vira aviso de recarregar, não erro cru', async () => {
    saveDraftAnswers.mockRejectedValueOnce(new StaleRevisionError())
    const result = await chamarAction({
      intent: 'salvar',
      versionId: 'ver-1',
      revision: '3',
      step: 'empresa',
    })
    const { status, body } = desembrulhar(result)
    // 409 de verdade: um 200 faria o cliente tratar a recusa como sucesso.
    expect(status).toBe(409)
    expect(body).toMatchObject({ ok: false, stale: true })
    expect(JSON.stringify(body)).toMatch(/outra aba/i)
  })

  it('falha inesperada não vaza detalhe técnico', async () => {
    saveDraftAnswers.mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))
    const result = await chamarAction({
      intent: 'salvar',
      versionId: 'ver-1',
      revision: '3',
      step: 'empresa',
    })
    const { status, body } = desembrulhar(result)
    expect(status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('SQLITE')
    expect(body).toMatchObject({ ok: false })
  })
})

describe('envio para revisão', () => {
  it('chama submitDraft com o tenant da sessão', async () => {
    const result = await chamarAction({ intent: 'enviar', versionId: 'ver-1', revision: '3' })
    expect(submitDraft).toHaveBeenCalledWith({
      versionId: 'ver-1',
      tenantId: 'tenant-1',
      accountId: OPERATOR.accountId,
      expectedRevision: 3,
    })
    // Sucesso REDIRECIONA: o loader revalida e mostra "recebemos suas respostas".
    expect(result).toMatchObject({ status: 302 })
  })

  it('o servidor revalida a completude — POST direto não passa por cima', async () => {
    submitDraft.mockRejectedValueOnce(new SubmitNotReadyError({ empresa: ['nome'] }))
    const result = await chamarAction({ intent: 'enviar', versionId: 'ver-1', revision: '3' })
    const { status, body } = desembrulhar(result)
    expect(status).toBe(422)
    expect(body).toMatchObject({ ok: false })
    expect(JSON.stringify(body)).toMatch(/faltam/i)
  })

  it('não envia versão que não é a do tenant', async () => {
    const result = await chamarAction({ intent: 'enviar', versionId: 'outra', revision: '3' })
    expect(submitDraft).not.toHaveBeenCalled()
    const { status, body } = desembrulhar(result)
    expect(status).toBe(409)
    expect(body).toMatchObject({ ok: false, stale: true })
  })
})

describe('estados que não são rascunho', () => {
  it('depois de submeter, o loader devolve a MESMA versão em submitted', async () => {
    // Sem isto a tela abriria um questionário novo — e outro onboarding poderia ser
    // submetido enquanto o primeiro job ainda está pendente.
    draft = { ...draft, state: 'submitted' }
    const data = await chamarLoader()
    expect(data.state).toBe('submitted')
    expect(data.versionId).toBe('ver-1')
  })

  it('needs_changes traz a nota da revisão para o cliente ler', async () => {
    draft = { ...draft, state: 'needs_changes', reviewNote: 'faltou o horário de sábado' }
    const data = await chamarLoader()
    expect(data.state).toBe('needs_changes')
    expect(data.reviewNote).toBe('faltou o horário de sábado')
  })

  it('reabrir para correção é explícito e passa pela transição', async () => {
    const result = await chamarAction({ intent: 'reabrir', versionId: 'ver-1', revision: '3' })
    expect(reopenForChanges).toHaveBeenCalledWith({
      versionId: 'ver-1',
      tenantId: 'tenant-1',
      expectedRevision: 3,
    })
    expect(result).toMatchObject({ status: 302 })
  })

  it('conflito ao reabrir também responde 409', async () => {
    reopenForChanges.mockRejectedValueOnce(new StaleRevisionError())
    const result = await chamarAction({ intent: 'reabrir', versionId: 'ver-1', revision: '3' })
    const { status, body } = desembrulhar(result)
    expect(status).toBe(409)
    expect(body).toMatchObject({ stale: true })
  })

  it('tenant sem versão pendente não recebe rascunho automático', async () => {
    loadSetupWorkspace.mockResolvedValueOnce({
      version: null as unknown as typeof draft,
      published: true,
      activated: true,
    })
    const data = await chamarLoader()
    expect(data.versionId).toBeNull()
    expect(data.state).toBeNull()
    expect(data.published).toBe(true)
  })
})
