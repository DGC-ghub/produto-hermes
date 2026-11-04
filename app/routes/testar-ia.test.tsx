import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MemoryRouter,
  redirect,
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  UNSAFE_RouteContext,
} from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// O simulador interno roda o MOTOR REAL no tenant de quem está logado. Duas garantias
// pesam mais que o resto e são o motivo destes testes: (1) o tenant e a identidade da
// conversa vêm SÓ da sessão — nunca do formulário —, senão a tela vira porta pra ler a
// conversa de outra empresa; (2) sem base de conhecimento a IA não é chamada, porque
// responder "sobre a empresa" sem saber nada dela é alucinação com selo do produto.
// O limite externo (o cérebro) é mockado: a suíte nunca sobe o Claude CLI.

type Operator = {
  accountId: string
  username: string
  role: string
  tenantId: string
  tenantSlug: string
}

const OPERATOR: Operator = {
  accountId: 'acc-1',
  username: 'dono@acme.com',
  role: 'owner',
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
}

// Estado que cada teste ajusta antes de chamar loader/action.
let operator: Operator = OPERATOR
let authFails = false
let docs: { id: string; title: string; content: string; position: number }[] = []
let config: { businessProfile: { segment: string } } | null = null

type Conv = {
  id: string
  tenantId: string
  contactId: string
  channel: string
  status: string
  updatedAt: Date
}
type Msg = {
  id: string
  conversationId: string
  role: string
  content: string
  confidence: number | null
  sourcesJson: string | null
  createdAt: Date
}
let conversations: Conv[] = []
let messages: Msg[] = []

vi.mock('../lib/auth.server', () => ({
  requireOperator: vi.fn(async () => {
    if (authFails) {
      throw redirect('/login?redirectTo=%2Ftestar-ia')
    }
    return operator
  }),
}))

vi.mock('../lib/knowledge-db.server', () => ({
  listKnowledgeDocs: vi.fn(async () => docs),
}))

vi.mock('../lib/attendant/tenant-config-db.server', () => ({
  resolveTenantConfig: vi.fn(async () => config),
}))

vi.mock('../lib/conversation.server', () => ({
  processIncomingMessage: vi.fn(async () => ({
    conversationId: 'conv-nova',
    tenantSlug: 'acme',
    userMessageId: 'm-user',
    assistantMessageId: 'm-ai',
    reply: 'ok',
    needsHuman: false,
    confidence: 0.9,
    sources: [],
  })),
}))

// Banco falso que FILTRA de verdade: assim os testes de isolamento provam comportamento
// (a conversa alheia não volta), não a forma da query.
vi.mock('../db.server', () => ({
  db: {
    conversation: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = conversations
          .filter((c) => {
            if (where.id !== undefined && c.id !== where.id) return false
            if (where.tenantId !== undefined && c.tenantId !== where.tenantId) return false
            if (where.contactId !== undefined && c.contactId !== where.contactId) return false
            if (where.channel !== undefined && c.channel !== where.channel) return false
            return true
          })
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        return found[0] ?? null
      }),
    },
    message: {
      findMany: vi.fn(async ({ where }: { where: { conversationId?: string } }) =>
        messages
          .filter((m) => !where.conversationId || m.conversationId === where.conversationId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ),
    },
  },
}))

import { processIncomingMessage } from '../lib/conversation.server'
import Screen, { action, loader, simulatorComposerKey, simulatorContactId } from './testar-ia'

const OWN_CONTACT = simulatorContactId(OPERATOR.accountId)

function makeConv(over: Partial<Conv> = {}): Conv {
  return {
    id: 'conv-own',
    tenantId: OPERATOR.tenantId,
    contactId: OWN_CONTACT,
    channel: 'simulator',
    status: 'open',
    updatedAt: new Date('2026-08-03T12:00:00Z'),
    ...over,
  }
}

function callLoader(url = 'https://h/testar-ia') {
  return loader({ request: new Request(url) } as Parameters<typeof loader>[0])
}

function callAction(fields: Record<string, string>) {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, value)
  }
  return action({
    request: new Request('https://h/testar-ia', { method: 'POST', body }),
  } as Parameters<typeof action>[0])
}

beforeEach(() => {
  vi.clearAllMocks()
  operator = OPERATOR
  authFails = false
  docs = [{ id: 'doc-1', title: 'Serviços', content: 'Atendemos das 8h às 18h.', position: 0 }]
  config = { businessProfile: { segment: 'clínica' } }
  conversations = []
  messages = []
})

describe('/testar-ia — portão e isolamento', () => {
  it('redireciona para o login quem não tem sessão', async () => {
    authFails = true
    await expect(callLoader()).rejects.toMatchObject({ status: 302 })
    await expect(callAction({ message: 'oi' })).rejects.toMatchObject({ status: 302 })
  })

  it('usa o tenant da SESSÃO, ignorando o que vier no formulário', async () => {
    await callAction({ message: 'quanto custa?', tenantSlug: 'outra-empresa', tenantId: 'x' })
    expect(processIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantSlug: 'acme' }),
    )
  })

  it('deriva o contactId da conta autenticada, ignorando o do formulário', async () => {
    await callAction({ message: 'quanto custa?', contactId: '5511999990000' })
    expect(processIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: OWN_CONTACT }),
    )
    expect(OWN_CONTACT).toContain(OPERATOR.accountId)
  })

  it('executa em owner_preview — canal e ausência de efeitos vêm do MODO', async () => {
    // Antes esta tela mandava `channel: 'simulator'` + `preview: true`, dois campos que
    // podiam divergir. Agora manda o modo, e canal e efeitos são consequência dele (§7.2).
    await callAction({ message: 'quanto custa?' })

    expect(processIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'owner_preview' }),
    )
    // Sem snapshot: esta tela testa a config PUBLICADA, não a candidata em revisão.
    expect(vi.mocked(processIncomingMessage).mock.calls[0][0]).not.toHaveProperty('previewSnapshot')
  })

  it('ignora conversationId de outro tenant', async () => {
    conversations = [makeConv({ id: 'conv-alheia', tenantId: 'tenant-2' })]
    await callAction({ message: 'oi', conversationId: 'conv-alheia' })
    expect(processIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: undefined }),
    )
  })

  it('ignora conversationId de outra conta do mesmo tenant', async () => {
    conversations = [makeConv({ id: 'conv-colega', contactId: simulatorContactId('acc-2') })]
    await callAction({ message: 'oi', conversationId: 'conv-colega' })
    expect(processIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: undefined }),
    )
  })

  it('ignora conversationId de outro canal (ex.: WhatsApp real do mesmo tenant)', async () => {
    conversations = [makeConv({ id: 'conv-wpp', channel: 'whatsapp' })]
    await callAction({ message: 'oi', conversationId: 'conv-wpp' })
    expect(processIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: undefined }),
    )
  })

  it('continua a conversa válida da própria identidade', async () => {
    conversations = [makeConv()]
    await callAction({ message: 'e o prazo?', conversationId: 'conv-own' })
    expect(processIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-own' }),
    )
  })

  it('não mostra histórico de outro tenant', async () => {
    conversations = [makeConv({ id: 'conv-alheia', tenantId: 'tenant-2' })]
    messages = [
      {
        id: 'm-alheia',
        conversationId: 'conv-alheia',
        role: 'user',
        content: 'segredo da outra empresa',
        confidence: null,
        sourcesJson: null,
        createdAt: new Date('2026-08-03T12:00:00Z'),
      },
    ]
    const result = await callLoader()
    expect(result.messages).toHaveLength(0)
    expect(JSON.stringify(result)).not.toContain('segredo da outra empresa')
  })

  it('não mostra histórico de outra identidade do mesmo tenant', async () => {
    conversations = [makeConv({ id: 'conv-colega', contactId: simulatorContactId('acc-2') })]
    messages = [
      {
        id: 'm-colega',
        conversationId: 'conv-colega',
        role: 'user',
        content: 'rascunho do colega',
        confidence: null,
        sourcesJson: null,
        createdAt: new Date('2026-08-03T12:00:00Z'),
      },
    ]
    const result = await callLoader()
    expect(result.messages).toHaveLength(0)
    expect(JSON.stringify(result)).not.toContain('rascunho do colega')
  })

  it('mostra o histórico da própria identidade', async () => {
    conversations = [makeConv()]
    messages = [
      {
        id: 'm-1',
        conversationId: 'conv-own',
        role: 'user',
        content: 'quanto custa?',
        confidence: null,
        sourcesJson: null,
        createdAt: new Date('2026-08-03T12:00:00Z'),
      },
    ]
    const result = await callLoader()
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].content).toBe('quanto custa?')
  })
})

describe('/testar-ia — base vazia não chama a IA', () => {
  it('loader reporta que não está pronto e aponta o Conhecimento', async () => {
    docs = []
    const result = await callLoader()
    expect(result.ready).toBe(false)
    expect(result.missing).toContain('knowledge')
  })

  it('doc só com espaço em branco não conta como base', async () => {
    docs = [{ id: 'doc-1', title: 'Vazio', content: '   \n  ', position: 0 }]
    const result = await callLoader()
    expect(result.ready).toBe(false)
  })

  it('action revalida no servidor e NÃO chama o motor', async () => {
    docs = []
    const result = await callAction({ message: 'quanto custa?' })
    expect(processIncomingMessage).not.toHaveBeenCalled()
    expect(result).toMatchObject({ needsKnowledge: true })
  })

  it('sinaliza o perfil incompleto sem bloquear quem já tem base', async () => {
    config = { businessProfile: { segment: 'não informado' } }
    const result = await callLoader()
    expect(result.ready).toBe(true)
    expect(result.missing).toContain('profile')
  })

  it('a tela oferece link para /conhecimento quando falta base', () => {
    const html = render({ ready: false, missing: ['knowledge', 'profile'] })
    // O href sozinho não prova nada (o menu lateral também o tem): o que vale é o
    // convite explícito no corpo da orientação.
    expect(html).toContain('Adicionar base de conhecimento')
    expect(html).toContain('Completar o perfil da empresa')
    expect(html).toContain('href="/conhecimento"')
    expect(html).toContain('href="/configuracoes"')
    // Sem base, não pode haver campo de envio convidando a testar.
    expect(html).not.toContain('name="message"')
  })
})

describe('/testar-ia — envio', () => {
  it('mensagem vazia não chama o motor', async () => {
    await callAction({ message: '   ' })
    expect(processIncomingMessage).not.toHaveBeenCalled()
  })

  it('corta a mensagem no teto do projeto', async () => {
    await callAction({ message: 'a'.repeat(5000) })
    const arg = vi.mocked(processIncomingMessage).mock.calls[0][0]
    expect(arg.message.length).toBe(2000)
  })

  it('falha do motor vira frase segura, sem erro cru', async () => {
    vi.mocked(processIncomingMessage).mockRejectedValueOnce(
      new Error('spawn claude ENOENT /usr/bin/claude'),
    )
    const result = await callAction({ message: 'quanto custa?' })
    const texto = JSON.stringify(result)
    expect(texto).not.toContain('ENOENT')
    expect(texto).not.toContain('spawn claude')
    expect(result).toMatchObject({ error: expect.stringContaining('Não consegui') })
  })
})

// ── Tela ────────────────────────────────────────────────────────────────────
// A suíte roda em node: olhamos a marcação renderizada, como nas outras telas.

type LoaderData = {
  ready: boolean
  missing: string[]
  messages: { id: string; role: string; content: string; confidence: number | null }[]
  conversationId: string | null
  operator: { username: string; tenantSlug: string }
}

function render(over: Partial<LoaderData> = {}, navigation: Record<string, unknown> = {}): string {
  const loaderData: LoaderData = {
    ready: true,
    missing: [],
    messages: [],
    conversationId: null,
    operator: { username: 'dono@acme.com', tenantSlug: 'acme' },
    ...over,
  }
  const Component = Screen as unknown as (props: { loaderData: LoaderData }) => ReactNode
  const routeContext = {
    matches: [{ route: { id: 'testar-ia' }, pathname: '/testar-ia', pathnameBase: '/' }],
    outlet: null,
    isDataRoute: true,
  }
  const routerContext = { router: { basename: '/' }, navigator: {}, static: false, basename: '/' }
  const state = {
    navigation: { state: 'idle', ...navigation },
    revalidation: 'idle',
    loaderData: {},
    actionData: undefined,
  }
  return renderToStaticMarkup(
    <MemoryRouter>
      {/* biome-ignore lint/suspicious/noExplicitAny: contextos internos do router no teste */}
      <UNSAFE_DataRouterContext.Provider value={routerContext as any}>
        {/* biome-ignore lint/suspicious/noExplicitAny: idem */}
        <UNSAFE_DataRouterStateContext.Provider value={state as any}>
          {/* biome-ignore lint/suspicious/noExplicitAny: idem */}
          <UNSAFE_RouteContext.Provider value={routeContext as any}>
            <Component loaderData={loaderData} />
          </UNSAFE_RouteContext.Provider>
        </UNSAFE_DataRouterStateContext.Provider>
      </UNSAFE_DataRouterContext.Provider>
    </MemoryRouter>,
  )
}

describe('/testar-ia — tela', () => {
  it('diz que é simulador e que não envia WhatsApp', () => {
    const html = render()
    expect(html).toMatch(/simula|simulador/i)
    expect(html).toMatch(/não envia|nada é enviado|sem enviar/i)
  })

  it('trava os controles durante o envio', () => {
    const formData = new FormData()
    formData.append('message', 'quanto custa?')
    const html = render({}, { state: 'submitting', formData })
    // textarea e botão desabilitados: dois cliques não viram duas rodadas do cérebro.
    expect(html.match(/disabled/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(html).toMatch(/Enviando|pensando|respondendo/i)
  })

  it('limpa o textarea mudando a identidade do editor após persistir', () => {
    expect(simulatorComposerKey([])).toBe('novo')
    expect(simulatorComposerKey([{ id: 'm-9' }])).toBe('m-9')
    expect(simulatorComposerKey([{ id: 'm-9' }, { id: 'm-10' }])).toBe('m-10')
  })

  it('não traz gravador de áudio nesta primeira versão', () => {
    const html = render()
    expect(html).not.toContain('type="file"')
    expect(html).not.toMatch(/áudio/i)
  })
})
