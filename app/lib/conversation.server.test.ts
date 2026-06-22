import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { processIncomingMessage } from './conversation.server'

const TEST_CONTACT_ID = 'test-task-10'

// Limpa apenas o que foi criado pelos testes (contactId controlado). Nunca apaga
// tenants reais nem conversas de outros contatos.
afterEach(async () => {
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

describe('processIncomingMessage', () => {
  it('creates a conversation and saves both user and assistant messages', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Quais são os preços dos serviços de vocês?',
      contactId: TEST_CONTACT_ID,
    })

    expect(result.conversationId).toBeTruthy()
    expect(result.userMessageId).toBeTruthy()
    expect(result.assistantMessageId).toBeTruthy()
    expect(result.reply.length).toBeGreaterThan(0)

    const messages = await db.message.findMany({
      where: { conversationId: result.conversationId },
      orderBy: { createdAt: 'asc' },
    })
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[0].content).toContain('preços')
  })

  it('reuses an existing conversation when conversationId is provided', async () => {
    const first = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Quais são os preços dos serviços?',
      contactId: TEST_CONTACT_ID,
    })

    const second = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'E o prazo de entrega?',
      conversationId: first.conversationId,
      contactId: TEST_CONTACT_ID,
    })

    expect(second.conversationId).toBe(first.conversationId)

    const messages = await db.message.findMany({
      where: { conversationId: first.conversationId },
    })
    expect(messages.length).toBe(4)
  })

  it('answers a normal DGC question without handoff and with sources', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Quais são os preços dos serviços?',
      contactId: TEST_CONTACT_ID,
    })

    expect(result.needsHuman).toBe(false)
    expect(result.sources.length).toBeGreaterThan(0)
  })

  it('escalates to human, marks conversation and creates a HandoffEvent', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Quero falar com um humano por favor',
      contactId: TEST_CONTACT_ID,
    })

    expect(result.needsHuman).toBe(true)
    expect(result.handoffReason).toBe('requested_human')

    const conversation = await db.conversation.findUnique({
      where: { id: result.conversationId },
    })
    expect(conversation?.status).toBe('needs_human')

    const events = await db.handoffEvent.findMany({
      where: { conversationId: result.conversationId },
    })
    expect(events.length).toBe(1)
    expect(events[0].reason).toBe('requested_human')
  })

  it('escalates with no_knowledge_match when nothing useful is found', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'xyzzy plimplom qwerty zzxx',
      contactId: TEST_CONTACT_ID,
    })

    expect(result.needsHuman).toBe(true)
    expect(result.handoffReason).toBe('no_knowledge_match')
  })

  it('rejects an empty message', async () => {
    await expect(
      processIncomingMessage({
        tenantSlug: 'dgc',
        message: '   ',
        contactId: TEST_CONTACT_ID,
      }),
    ).rejects.toThrow('Message is required')
  })

  it('rejects an unknown tenant', async () => {
    await expect(
      processIncomingMessage({
        tenantSlug: 'empresa-inexistente',
        message: 'Olá',
        contactId: TEST_CONTACT_ID,
      }),
    ).rejects.toThrow('Unknown tenant')
  })
})
