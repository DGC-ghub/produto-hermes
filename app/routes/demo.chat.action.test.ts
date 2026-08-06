import { beforeEach, describe, expect, it, vi } from 'vitest'

// A ACTION da demo pública, com as bordas mockadas.
//
// Prova duas coisas que os helpers puros não alcançam: que a demo executa em
// `public_demo` — e não num modo com efeitos, que é o que enchia a Central do cliente de
// visitante anônimo (§7.3) — e que o aviso do RETORNO chega ao redirect.
//
// Arquivo separado de `demo.chat.test.ts` para os mocks não valerem para os testes puros.

const motor = vi.hoisted(() => ({
  chamadas: [] as unknown[],
  needsHuman: false,
}))

vi.mock('../lib/conversation.server', () => ({
  processIncomingMessage: vi.fn(async (input: unknown) => {
    motor.chamadas.push(input)
    return {
      conversationId: 'conv-1',
      tenantSlug: 'dgc',
      userMessageId: 'm-user',
      assistantMessageId: 'm-ai',
      reply: 'ok',
      needsHuman: motor.needsHuman,
      confidence: 0.9,
      sources: [],
    }
  }),
}))

vi.mock('../lib/demo-visitor.server', () => ({
  readDemoVisitor: vi.fn(async () => ({ visitorId: 'visitante-1', setCookie: null })),
  demoContactId: (id: string) => `demo:${id}`,
  truncateDemoMessage: (m: string) => m,
  checkVisitorQuota: () => ({ allowed: true, state: new Map() }),
  DEMO_MAX_PER_VISITOR: 10,
}))

vi.mock('../db.server', () => ({
  db: {
    conversation: { findFirst: vi.fn(async () => null) },
    message: { findMany: vi.fn(async () => []) },
    tenant: { findUnique: vi.fn(async () => null) },
  },
}))

vi.mock('../lib/audio/upload.server', () => ({
  transcribeUploadedAudio: vi.fn(async () => 'transcrito'),
}))

const { action } = await import('./demo.chat')
const { processIncomingMessage } = await import('../lib/conversation.server')

function enviar(campos: Record<string, string>) {
  const body = new FormData()
  for (const [k, v] of Object.entries(campos)) {
    body.append(k, v)
  }
  return action({
    request: new Request('https://h/demo/chat', { method: 'POST', body }),
  } as Parameters<typeof action>[0])
}

beforeEach(() => {
  motor.chamadas = []
  motor.needsHuman = false
  vi.clearAllMocks()
})

describe('a demo pública executa em public_demo', () => {
  it('o modo é public_demo, e sem snapshot da candidata', async () => {
    await enviar({ tenantSlug: 'dgc', message: 'vocês fazem automação?' })

    expect(processIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'public_demo' }),
    )
    // Material em revisão não pode aparecer numa vitrine pública.
    expect(motor.chamadas[0]).not.toHaveProperty('previewSnapshot')
  })

  it('o contato vem da identidade anônima do visitante, não do formulário', async () => {
    await enviar({ tenantSlug: 'dgc', message: 'oi', contactId: '5511999990000' })

    expect(processIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'demo:visitante-1' }),
    )
  })
})

describe('o aviso de humano sobrevive ao redirect', () => {
  /** O `Location` do redirect que a action devolve. */
  async function destino(campos: Record<string, string>): Promise<string> {
    const r = (await enviar(campos)) as Response
    return r.headers.get('Location') ?? ''
  }

  it('needsHuman=true chega na URL', async () => {
    motor.needsHuman = true

    const location = await destino({ tenantSlug: 'dgc', message: 'quero falar com alguém' })

    expect(location).toContain('humano=1')
    expect(location).toContain('tenant=dgc')
    expect(location).toContain('conversationId=conv-1')
  })

  it('needsHuman=false não carrega o aviso adiante', async () => {
    // O par que impede o aviso de uma rodada ficar colado na tela nas seguintes.
    motor.needsHuman = false

    expect(await destino({ tenantSlug: 'dgc', message: 'obrigado' })).not.toContain('humano')
  })
})
