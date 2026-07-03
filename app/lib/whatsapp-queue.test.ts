import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { registerWhatsappNumber } from './whatsapp.server'
import { drainPending, persistInbound } from './whatsapp-queue.server'

const TEST_CONTACT_ID = 'test-queue-5511999990000'
const TEST_PHONE_ID = 'test-queue-phone-id'
const UNMAPPED_PHONE_ID = 'test-queue-phone-desconhecido'

function inbound(
  messageId: string,
  overrides: Partial<Parameters<typeof persistInbound>[0][0]> = {},
) {
  return {
    from: TEST_CONTACT_ID,
    text: 'Quais são os preços dos serviços?',
    phoneNumberId: TEST_PHONE_ID,
    messageId,
    ...overrides,
  }
}

beforeEach(async () => {
  // Mapeia o número de teste pro tenant dgc (o caminho REAL de resolução).
  await registerWhatsappNumber(TEST_PHONE_ID, 'dgc')
})

afterEach(async () => {
  await db.webhookEvent.deleteMany({ where: { contactId: TEST_CONTACT_ID } })
  await db.whatsappNumber.deleteMany({ where: { phoneNumberId: TEST_PHONE_ID } })
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

describe('persistInbound', () => {
  it('persiste o evento e deduplica redelivery pelo messageId (wamid)', async () => {
    const first = await persistInbound([inbound('wamid.test-dedup-1')])
    const redelivery = await persistInbound([inbound('wamid.test-dedup-1')])

    expect(first).toBe(1)
    expect(redelivery).toBe(0)

    const rows = await db.webhookEvent.findMany({
      where: { messageId: 'wamid.test-dedup-1' },
    })
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('pending')
  })
})

describe('drainPending', () => {
  it('processa o evento pelo motor real e marca done (uma resposta só)', async () => {
    await persistInbound([inbound('wamid.test-drain-ok')])
    await drainPending()
    // Redelivery DEPOIS de processado: dedup segura, nada novo pra processar.
    await persistInbound([inbound('wamid.test-drain-ok')])
    await drainPending()

    const event = await db.webhookEvent.findUnique({
      where: { messageId: 'wamid.test-drain-ok' },
    })
    expect(event?.status).toBe('done')
    expect(event?.processedAt).not.toBeNull()

    // O motor rodou UMA vez: uma conversa com [user, assistant], sem dupla resposta.
    // E a conversa nasce com o canal REAL (não 'simulator') — métrica por canal.
    const conversations = await db.conversation.findMany({
      where: { contactId: TEST_CONTACT_ID },
      select: { id: true, channel: true },
    })
    expect(conversations.length).toBe(1)
    expect(conversations[0].channel).toBe('whatsapp')
    const messages = await db.message.findMany({
      where: { conversationId: conversations[0].id },
      orderBy: { createdAt: 'asc' },
    })
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('evento sem tenant mapeado fica pending com retry e vira failed no teto', async () => {
    await persistInbound([inbound('wamid.test-veneno', { phoneNumberId: UNMAPPED_PHONE_ID })])

    // 4 tentativas: ainda pending (vai tentar de novo).
    for (let i = 0; i < 4; i++) {
      await drainPending()
    }
    let event = await db.webhookEvent.findUnique({ where: { messageId: 'wamid.test-veneno' } })
    expect(event?.status).toBe('pending')
    expect(event?.attempts).toBe(4)

    // 5ª tentativa: descarta (failed) — evento-veneno não entope a fila pra sempre.
    await drainPending()
    event = await db.webhookEvent.findUnique({ where: { messageId: 'wamid.test-veneno' } })
    expect(event?.status).toBe('failed')

    // E não processa mais nas passadas seguintes.
    await drainPending()
    event = await db.webhookEvent.findUnique({ where: { messageId: 'wamid.test-veneno' } })
    expect(event?.attempts).toBe(5)
  })
})
