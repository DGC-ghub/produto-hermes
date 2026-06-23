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

  it('does not force handoff just because the base had no match', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'xyzzy plimplom qwerty zzxx',
      contactId: TEST_CONTACT_ID,
    })

    // Sem gatilho de segurança, a IA decide — não escala cegamente por falta de match.
    expect(result.needsHuman).toBe(false)
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

  it('extracts a lead from a message with signals', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Minha geladeira parou hoje no Jardim América',
      contactId: TEST_CONTACT_ID,
    })

    const lead = await db.lead.findUnique({ where: { conversationId: result.conversationId } })
    expect(lead).not.toBeNull()
    expect(lead?.urgency).toBe('alta')
    expect(lead?.neighborhood).toBe('Jardim América')
    expect(lead?.need?.toLowerCase()).toContain('geladeira')
    expect(lead?.stage).toBe('novo')
  })

  it('updates the existing lead on a second message without duplicating or clobbering', async () => {
    const first = await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Minha geladeira parou hoje no Jardim América',
      contactId: TEST_CONTACT_ID,
    })

    await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Na verdade é o fogão',
      conversationId: first.conversationId,
      contactId: TEST_CONTACT_ID,
    })

    const leads = await db.lead.findMany({ where: { conversationId: first.conversationId } })
    expect(leads.length).toBe(1)
    // need acompanha a mensagem mais recente...
    expect(leads[0].need?.toLowerCase()).toContain('fogão')
    // ...mas bairro/urgência anteriores não são apagados por uma mensagem sem esses sinais.
    expect(leads[0].neighborhood).toBe('Jardim América')
    expect(leads[0].urgency).toBe('alta')
  })
})
