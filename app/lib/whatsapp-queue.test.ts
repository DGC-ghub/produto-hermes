import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import { sendReply } from './channels/dispatch.server'
import { ensureInitialTenants } from './tenants.server'
import { registerWhatsappNumber } from './whatsapp.server'
import { drainPending, persistBaileysInbound, persistInbound } from './whatsapp-queue.server'

// Mocka o envio: os testes exercitam a FILA/MOTOR, não o transporte. Default = entregue.
vi.mock('./channels/dispatch.server', () => ({ sendReply: vi.fn(async () => true) }))

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
    kind: 'text' as const,
    ...overrides,
  }
}

beforeEach(async () => {
  // Banco de teste nasce vazio: garante os tenants antes de mapear o número
  // (registerWhatsappNumber não cria tenant por demanda — onboarding é explícito).
  await ensureInitialTenants()
  // Mapeia o número de teste pro tenant dgc (o caminho REAL de resolução).
  await registerWhatsappNumber(TEST_PHONE_ID, 'dgc')
  vi.mocked(sendReply).mockReset().mockResolvedValue(true) // default: envio entregue
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

  it('reenvia o envio ao falhar (blip) sem reprocessar o motor, e completa (#8)', async () => {
    // 1ª tentativa de envio falha; sendWithRetry reenvia e entrega na 2ª.
    vi.mocked(sendReply).mockReset().mockResolvedValueOnce(false).mockResolvedValue(true)
    await persistInbound([inbound('wamid.test-send-retry')])
    await drainPending()

    const event = await db.webhookEvent.findUnique({
      where: { messageId: 'wamid.test-send-retry' },
    })
    expect(event?.status).toBe('done')
    // envio foi TENTADO ao menos 2x (falhou → reenviou)...
    expect(vi.mocked(sendReply).mock.calls.length).toBeGreaterThanOrEqual(2)
    // ...mas o motor rodou UMA vez só (não duplicou): uma conversa.
    const convs = await db.conversation.findMany({ where: { contactId: TEST_CONTACT_ID } })
    expect(convs.length).toBe(1)
  })

  // Áudio/mídia: cortesia sem motor — marca done e NÃO cria conversa (o conteúdo
  // real ainda não é lido; a transcrição entra na 2ª quinzena de agosto).
  it('evento unsupported (áudio) vira done sem rodar o motor nem criar conversa', async () => {
    await persistInbound([
      inbound('wamid.test-audio-1', { kind: 'unsupported' as const, text: '' }),
    ])
    await drainPending()

    const event = await db.webhookEvent.findUnique({
      where: { messageId: 'wamid.test-audio-1' },
    })
    expect(event?.status).toBe('done')

    const conversations = await db.conversation.findMany({
      where: { contactId: TEST_CONTACT_ID },
    })
    expect(conversations.length).toBe(0)
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

describe('persistBaileysInbound (canal QR)', () => {
  const SID = 'test-queue-session-1'
  const CONTACT = 'test-queue-baileys-5511977776666'

  afterEach(async () => {
    await db.webhookEvent.deleteMany({ where: { contactId: CONTACT } })
  })

  it('persiste evento Baileys com messageId prefixado por sessão + channelSessionId', async () => {
    const n = await persistBaileysInbound({
      channelSessionId: SID,
      contactId: CONTACT,
      remoteJid: `${CONTACT}@s.whatsapp.net`,
      messageId: 'ABC',
      kind: 'text',
      text: 'oi',
    })
    expect(n).toBe(1)
    const row = await db.webhookEvent.findFirst({ where: { contactId: CONTACT } })
    expect(row?.messageId).toBe(`b:${SID}:ABC`) // prefixo escopa o dedup por sessão
    expect(row?.channelSessionId).toBe(SID)
    expect(row?.phoneNumberId).toBe('') // Baileys não tem phoneNumberId
    expect(row?.text).toBe('oi')
    expect(row?.remoteJid).toBe(`${CONTACT}@s.whatsapp.net`) // jid original guardado (FU1)
  })

  it('dedup por (sessão, messageId): o mesmo evento não duplica (retorna 0)', async () => {
    const event = {
      channelSessionId: SID,
      contactId: CONTACT,
      remoteJid: 'x',
      messageId: 'DUP',
      kind: 'text' as const,
      text: 'oi',
    }
    expect(await persistBaileysInbound(event)).toBe(1)
    expect(await persistBaileysInbound(event)).toBe(0)
  })
})

describe('o silêncio da 6C chega até o fio', () => {
  // O ÚLTIMO METRO. Os cinco desfechos que a 6C criou — humano na entrada, humano assumiu,
  // conversa encerrada, apagada, status desconhecido — todos devolvem `reply: ''`, e essa
  // string atravessa exatamente UMA linha antes de virar (ou não) mensagem no WhatsApp do
  // cliente. Toda a garantia estava provada no BANCO e nenhuma vez no FIO, que é o único
  // lugar onde ela é visível para quem está do outro lado.
  //
  // Não há segunda barreira: nem `sendReply` nem o Baileys recusam texto vazio. No canal da
  // Meta um `text.body: ""` volta 400, o retry tenta três vezes e alarma `envio_whatsapp_falhou`
  // a CADA mensagem recebida durante atendimento humano — alarme falso que o operador aprende
  // a ignorar. No Baileys, uma bolha em branco dentro da conversa que ele está conduzindo.

  async function conversaEmAtendimentoHumano() {
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: 'dgc' } })
    return db.conversation.create({
      data: {
        tenantId: tenant.id,
        contactId: TEST_CONTACT_ID,
        channel: 'whatsapp',
        status: 'human',
      },
    })
  }

  it('com humano conduzindo, NADA é enviado ao cliente', async () => {
    const conversa = await conversaEmAtendimentoHumano()

    await persistInbound([inbound('wamid-silencio-humano')])
    await drainPending()

    // O Hermes se cala — e calar significa não mandar nada, não mandar vazio.
    expect(sendReply).not.toHaveBeenCalled()

    // A fala do cliente foi registrada para o atendente ver, e o evento concluiu: silêncio
    // não é falha, e reprocessar duplicaria a mensagem dele na tela.
    const mensagens = await db.message.findMany({
      where: { conversationId: conversa.id },
      select: { role: true },
    })
    expect(mensagens.map((m) => m.role)).toEqual(['user'])
    const evento = await db.webhookEvent.findFirstOrThrow({
      where: { messageId: 'wamid-silencio-humano' },
    })
    expect(evento.status).toBe('done')
  })

  it('áudio durante atendimento humano não recebe nem a cortesia', async () => {
    // A cortesia é a IA falando com o cliente, e ela não passa pelo motor — logo não passa
    // pelo CAS. Era o único ponto do produto que falava sem perguntar de quem é a conversa,
    // e como essa fala não vira `Message`, o operador nem descobria o que o cliente ouviu.
    await conversaEmAtendimentoHumano()

    await persistInbound([inbound('wamid-audio-humano', { kind: 'unsupported' })])
    await drainPending()

    expect(sendReply).not.toHaveBeenCalled()
  })

  it('áudio SEM humano conduzindo recebe a cortesia — o par positivo', async () => {
    // Sem este, calar sempre no ramo de mídia ficaria verde acima e o cliente que manda áudio
    // voltaria ao vácuo que esta cortesia existe para eliminar.
    await persistInbound([inbound('wamid-audio-sozinho', { kind: 'unsupported' })])
    await drainPending()

    expect(sendReply).toHaveBeenCalledTimes(1)
    // O destino importa: no Baileys responder aos dígitos reconstruídos em vez do jid original
    // vai para o vácuo — é para isso que a coluna `remoteJid` existe.
    expect(vi.mocked(sendReply).mock.calls[0]?.[1]).toBe(TEST_CONTACT_ID)
    expect(String(vi.mocked(sendReply).mock.calls[0]?.[2])).toContain('áudio')
  })
})
