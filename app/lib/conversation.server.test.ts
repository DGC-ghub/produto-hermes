import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { processIncomingMessage } from './conversation.server'

const TEST_CONTACT_ID = 'test-task-10'

// Limpa apenas o que foi criado pelos testes (contactId controlado). Nunca apaga
// tenants reais nem conversas de outros contatos.
afterEach(async () => {
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

describe('processIncomingMessage', () => {
  it('creates a conversation and saves both user and assistant messages', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Quais são os preços dos serviços de vocês?',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
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
      mode: 'whatsapp',
    })

    const second = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'E o prazo de entrega?',
      conversationId: first.conversationId,
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
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
      mode: 'whatsapp',
    })

    expect(result.needsHuman).toBe(false)
    expect(result.sources.length).toBeGreaterThan(0)
  })

  it('escalates to human, marks conversation and creates a HandoffEvent', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Quero falar com um humano por favor',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
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

  it('preview persiste a conversa, mas não cria lead, ticket, handoff ou status operacional', async () => {
    const first = await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Minha geladeira parou hoje no Jardim América e quero falar com um humano',
      contactId: TEST_CONTACT_ID,
      mode: 'owner_preview',
    })

    expect(first.needsHuman).toBe(true)
    expect(await db.lead.findUnique({ where: { conversationId: first.conversationId } })).toBeNull()
    expect(await db.handoffEvent.count({ where: { conversationId: first.conversationId } })).toBe(0)
    expect(
      (await db.conversation.findUnique({ where: { id: first.conversationId } }))?.status,
    ).toBe('open')

    const second = await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Quero abrir um chamado para a geladeira',
      conversationId: first.conversationId,
      contactId: TEST_CONTACT_ID,
      mode: 'owner_preview',
    })

    expect(second.reply.length).toBeGreaterThan(0)
    expect(await db.ticket.count({ where: { contactId: TEST_CONTACT_ID } })).toBe(0)
    expect(await db.message.count({ where: { conversationId: first.conversationId } })).toBe(4)
  })

  it('does not force handoff just because the base had no match', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'xyzzy plimplom qwerty zzxx',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
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
        mode: 'whatsapp',
      }),
    ).rejects.toThrow('Message is required')
  })

  it('rejects an unknown tenant', async () => {
    await expect(
      processIncomingMessage({
        tenantSlug: 'empresa-inexistente',
        message: 'Olá',
        contactId: TEST_CONTACT_ID,
        mode: 'whatsapp',
      }),
    ).rejects.toThrow('Unknown tenant')
  })

  it('extracts a lead from a message with signals', async () => {
    const result = await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Minha geladeira parou hoje no Jardim América',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
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
      mode: 'whatsapp',
    })

    await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Na verdade é o fogão',
      conversationId: first.conversationId,
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })

    const leads = await db.lead.findMany({ where: { conversationId: first.conversationId } })
    expect(leads.length).toBe(1)
    // need acompanha a mensagem mais recente...
    expect(leads[0].need?.toLowerCase()).toContain('fogão')
    // ...mas bairro/urgência anteriores não são apagados por uma mensagem sem esses sinais.
    expect(leads[0].neighborhood).toBe('Jardim América')
    expect(leads[0].urgency).toBe('alta')
  })

  // Identidade do contato: o caso do "lead que volta". No WhatsApp a mensagem chega
  // só com o número (contactId) e SEM conversationId — o motor deve reconhecer o
  // contato e continuar a conversa ativa, não criar uma nova a cada retorno.
  it('recognizes a returning contact (no conversationId) and continues the same conversation', async () => {
    const first = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Oi, quero saber sobre automações',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })

    // Retorno: mesmo contato, SEM conversationId (como chegaria do WhatsApp).
    const back = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Voltei pra continuar nossa conversa',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })

    expect(back.conversationId).toBe(first.conversationId)

    const messages = await db.message.findMany({ where: { conversationId: first.conversationId } })
    expect(messages.length).toBe(4)
  })

  it('keeps a single conversation and lead per contact across returns', async () => {
    const first = await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Minha geladeira parou no Jardim América',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })
    await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Voltei, alguma novidade?',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })

    const tenant = await db.tenant.findUnique({ where: { slug: 'assistencia-tecnica-demo' } })
    const conversations = await db.conversation.findMany({
      where: { tenantId: tenant?.id, contactId: TEST_CONTACT_ID },
      select: { id: true },
    })
    expect(conversations.length).toBe(1)

    const leads = await db.lead.findMany({
      where: { conversationId: { in: conversations.map((c) => c.id) } },
    })
    expect(leads.length).toBe(1)
    expect(first.conversationId).toBe(conversations[0].id)
  })

  // Dedup de chamados: reforçar o MESMO pedido não deve abrir um segundo chamado.
  it('does not open a duplicate ticket when the customer repeats the same request', async () => {
    await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Quero abrir um chamado: geladeira parada',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })
    await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Pode abrir o chamado, minha geladeira parada continua',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })

    const tickets = await db.ticket.findMany({ where: { contactId: TEST_CONTACT_ID } })
    expect(tickets.length).toBe(1)
  })

  // ...mas dois problemas DISTINTOS continuam virando dois chamados.
  it('opens separate tickets for genuinely different problems', async () => {
    await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Quero abrir um chamado: geladeira parada',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })
    await processIncomingMessage({
      tenantSlug: 'assistencia-tecnica-demo',
      message: 'Quero abrir um chamado: máquina de lavar vazando',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })

    const tickets = await db.ticket.findMany({ where: { contactId: TEST_CONTACT_ID } })
    expect(tickets.length).toBe(2)
  })

  // Identidade robusta: com mais de uma conversa aberta do mesmo contato (resíduo
  // de antes desta resolução), o retorno continua na de ATIVIDADE mais recente —
  // não simplesmente na criada por último. Cobre o bug do updatedAt congelado.
  it('reuses the conversation with the most recent activity, not just the newest', async () => {
    const tenant = await db.tenant.findUnique({ where: { slug: 'dgc' } })
    // `channel: 'whatsapp'` porque as chamadas abaixo rodam em `mode: 'whatsapp'`: a conversa
    // reutilizada tem que ser do canal do modo, e um fixture `simulator` aqui seria a mistura
    // de teste com atendimento real que o vínculo passou a recusar.
    const convA = await db.conversation.create({
      data: {
        tenantId: tenant?.id ?? '',
        contactId: TEST_CONTACT_ID,
        channel: 'whatsapp',
        status: 'open',
      },
    })
    // convB é criada depois (createdAt maior) — sem o toque no updatedAt, ela
    // "ganharia" a ordenação mesmo sem nenhuma atividade.
    await db.conversation.create({
      data: {
        tenantId: tenant?.id ?? '',
        contactId: TEST_CONTACT_ID,
        channel: 'whatsapp',
        status: 'open',
      },
    })

    // Atividade recente na conversa A.
    await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Mensagem ativa na conversa A',
      conversationId: convA.id,
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })

    // Retorno sem conversationId deve continuar em A (atividade mais recente).
    const back = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Voltei',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })
    expect(back.conversationId).toBe(convA.id)
  })

  // Assumir/devolver: enquanto um humano cuida (status 'human'), o Hermes fica em
  // silêncio — registra a mensagem do cliente, mas não gera resposta da IA.
  it('stays silent while a human is handling the conversation', async () => {
    const first = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Oi, preciso de ajuda',
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })
    await db.conversation.update({
      where: { id: first.conversationId },
      data: { status: 'human' },
    })

    const result = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'Alguém aí?',
      conversationId: first.conversationId,
      contactId: TEST_CONTACT_ID,
      mode: 'whatsapp',
    })

    expect(result.humanHandling).toBe(true)
    expect(result.reply).toBe('')

    // [user, assistant] da 1ª troca + [user] da 2ª (sem resposta da IA).
    const messages = await db.message.findMany({
      where: { conversationId: first.conversationId },
      orderBy: { createdAt: 'asc' },
    })
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })
})
