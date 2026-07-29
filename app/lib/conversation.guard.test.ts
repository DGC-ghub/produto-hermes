import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import { generateAttendantReply } from './attendant'
import { processIncomingMessage } from './conversation.server'

// Cérebro mockado no MÓDULO: aqui provamos que o guard determinístico curto-circuita
// o LLM (não paga latência nem executa efeitos de uma resposta descartada). O
// comportamento do provider em si é coberto em conversation.server.test.ts.
// `importOriginal` preserva o resto do módulo (ex.: activeProviderName, usado pela
// telemetria) — só o cérebro é trocado.
vi.mock('./attendant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./attendant')>()),
  generateAttendantReply: vi.fn(async () => ({
    reply: 'resposta do cérebro mockado',
    needsHuman: false,
    handoffReason: null,
    confidence: 0.5,
    leadPatch: null,
    action: {
      type: 'abrir_chamado',
      subject: 'chamado proposto pelo cérebro',
      description: 'só pode existir quando o guard NÃO curto-circuita',
    },
  })),
}))

const TEST_CONTACT_ID = 'test-guard-curto-circuito'

afterEach(async () => {
  vi.clearAllMocks()
  await db.ticket.deleteMany({ where: { contactId: TEST_CONTACT_ID } })
  const conversations = await db.conversation.findMany({
    where: { contactId: TEST_CONTACT_ID },
    select: { id: true },
  })
  const ids = conversations.map((c) => c.id)
  if (ids.length === 0) {
    return
  }
  await db.handoffEvent.deleteMany({ where: { conversationId: { in: ids } } })
  await db.lead.deleteMany({ where: { conversationId: { in: ids } } })
  await db.message.deleteMany({ where: { conversationId: { in: ids } } })
  await db.conversation.deleteMany({ where: { id: { in: ids } } })
})

describe('curto-circuito do guard determinístico', () => {
  it('não chama o cérebro nem executa efeitos quando o cliente pede humano', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Quero falar com um humano agora, e pode abrir um chamado disso',
      contactId: TEST_CONTACT_ID,
    })

    // O LLM não foi pago: a resposta já estava decidida pelo guard.
    expect(generateAttendantReply).not.toHaveBeenCalled()
    expect(result.needsHuman).toBe(true)
    expect(result.handoffReason).toBe('requested_human')
    // Resposta segura do tenant, não a do cérebro.
    expect(result.reply).not.toContain('cérebro mockado')
    expect(result.reply.length).toBeGreaterThan(0)
    expect(result.confidence).toBe(0)
    expect(result.sources).toEqual([])

    // Nenhum efeito colateral de uma proposta que o cliente nunca viu.
    const tickets = await db.ticket.findMany({ where: { contactId: TEST_CONTACT_ID } })
    expect(tickets.length).toBe(0)

    // A conversa escalou e o evento de handoff existe (comportamento preservado).
    const conversation = await db.conversation.findUnique({
      where: { id: result.conversationId },
    })
    expect(conversation?.status).toBe('needs_human')
    const events = await db.handoffEvent.findMany({
      where: { conversationId: result.conversationId },
    })
    expect(events.length).toBe(1)
    expect(events[0].reason).toBe('requested_human')

    // As duas mensagens persistidas (cliente + resposta segura).
    const messages = await db.message.findMany({
      where: { conversationId: result.conversationId },
      orderBy: { createdAt: 'asc' },
    })
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('chama o cérebro normalmente (e executa a ação) quando o guard não força', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Quais serviços vocês oferecem?',
      contactId: TEST_CONTACT_ID,
    })

    expect(generateAttendantReply).toHaveBeenCalledTimes(1)
    expect(result.reply).toContain('cérebro mockado')
    expect(result.needsHuman).toBe(false)

    // A ação proposta pelo cérebro executa no caminho normal.
    const tickets = await db.ticket.findMany({ where: { contactId: TEST_CONTACT_ID } })
    expect(tickets.length).toBe(1)
  })
})
