import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import { sendReply } from './channels/dispatch.server'
import { sendOperatorReply } from './operator-reply.server'
import { ensureTenant } from './tenants.server'

// Mocka o dispatcher pra capturar PRA ONDE o operador respondeu (canal + jid) sem socket
// real; retorna sucesso. vi.mock é hoisted, então vale pra todos os testes do arquivo.
vi.mock('./channels/dispatch.server', () => ({
  sendReply: vi.fn(async () => ({ status: 'sent', providerMessageId: 'wamid.op' })),
}))

const T = 'zzz-test-opreply'
const ORIGINAL = { ...process.env }
let tenantId = ''

beforeAll(async () => {
  await ensureTenant({ slug: T, name: 'OpReply' })
  const tenant = await db.tenant.findUnique({ where: { slug: T } })
  tenantId = tenant?.id ?? ''
})
beforeEach(() => {
  // Sem número/token → o envio cai no stub (sem fetch real à Meta); a persistência é o que importa.
  process.env.WHATSAPP_ACCESS_TOKEN = ''
  process.env.WHATSAPP_PHONE_NUMBER_ID = ''
})
afterEach(async () => {
  process.env = { ...ORIGINAL }
  const convs = await db.conversation.findMany({ where: { tenantId }, select: { id: true } })
  await db.message.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } })
  await db.conversation.deleteMany({ where: { tenantId } })
  const sess = await db.channelSession.findMany({ where: { tenantId }, select: { id: true } })
  await db.webhookEvent.deleteMany({ where: { channelSessionId: { in: sess.map((s) => s.id) } } })
  await db.channelSession.deleteMany({ where: { tenantId } })
})
afterAll(async () => {
  await db.tenant.deleteMany({ where: { slug: T } })
})

describe('sendOperatorReply (handoff — Tier 2)', () => {
  it('texto vazio → recusa', async () => {
    const r = await sendOperatorReply({ tenantId, tenantSlug: T, contactId: '5511999', text: '  ' })
    expect(r.ok).toBe(false)
  })

  it('sem conversa ativa → recusa', async () => {
    const r = await sendOperatorReply({ tenantId, tenantSlug: T, contactId: '5511000', text: 'oi' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Nenhuma conversa')
  })

  it('com conversa ativa: registra a fala do operador (role=assistant) na conversa', async () => {
    const conv = await db.conversation.create({
      data: { tenantId, contactId: '5511111', status: 'needs_human' },
    })
    await sendOperatorReply({
      tenantId,
      tenantSlug: T,
      contactId: '5511111',
      text: 'Olá, aqui é o atendente',
    })
    const msgs = await db.message.findMany({ where: { conversationId: conv.id } })
    expect(msgs).toHaveLength(1)
    expect(msgs[0]?.role).toBe('assistant')
    expect(msgs[0]?.content).toBe('Olá, aqui é o atendente')
  })

  it('conversa fechada não conta como ativa → recusa', async () => {
    await db.conversation.create({ data: { tenantId, contactId: '5511222', status: 'closed' } })
    const r = await sendOperatorReply({ tenantId, tenantSlug: T, contactId: '5511222', text: 'oi' })
    expect(r.ok).toBe(false)
  })

  it('só age na conversa do próprio tenant (não vaza para outro)', async () => {
    await ensureTenant({ slug: 'zzz-test-opreply-outro', name: 'Outro' })
    const outro = await db.tenant.findUnique({ where: { slug: 'zzz-test-opreply-outro' } })
    const conv = await db.conversation.create({
      data: { tenantId: outro?.id ?? '', contactId: '5511333', status: 'needs_human' },
    })
    // T tenta responder um contato que só existe no OUTRO tenant → não encontra conversa
    const r = await sendOperatorReply({ tenantId, tenantSlug: T, contactId: '5511333', text: 'oi' })
    expect(r.ok).toBe(false)
    const msgs = await db.message.findMany({ where: { conversationId: conv.id } })
    expect(msgs).toHaveLength(0) // nada foi escrito na conversa do outro
    await db.conversation.deleteMany({ where: { tenantId: outro?.id ?? '' } })
    await db.tenant.deleteMany({ where: { slug: 'zzz-test-opreply-outro' } })
  })

  it('empresa com sessão Baileys conectada: operador responde POR ELA no jid @lid original', async () => {
    const session = await db.channelSession.create({
      data: { tenantId, kind: 'baileys', status: 'conectado', label: 'op' },
    })
    await db.conversation.create({ data: { tenantId, contactId: '183709', status: 'needs_human' } })
    await db.webhookEvent.create({
      data: {
        messageId: `b:${session.id}:m1`,
        phoneNumberId: '',
        channelSessionId: session.id,
        contactId: '183709',
        remoteJid: '183709@lid',
        text: 'oi',
      },
    })
    vi.mocked(sendReply).mockClear()
    const r = await sendOperatorReply({
      tenantId,
      tenantSlug: T,
      contactId: '183709',
      text: 'resposta do humano',
    })
    expect(r.ok).toBe(true)
    // roteou pro canal Baileys da empresa E no jid @lid ORIGINAL (não nos dígitos)
    expect(sendReply).toHaveBeenCalledWith(
      { kind: 'baileys', sessionId: session.id },
      '183709@lid',
      'resposta do humano',
    )
  })
})

describe('o operador não é induzido a reenviar sobre a dúvida', () => {
  async function conversaComContato(contactId: string) {
    return db.conversation.create({
      data: { tenantId, contactId, channel: 'whatsapp', status: 'needs_human' },
    })
  }

  it('14. ambíguo: a tela NÃO diz que falhou, e pede conferência', async () => {
    // O caminho de duplicação que não precisa de crash: a tela dizia "o envio falhou", o
    // operador clicava de novo, e o cliente recebia duas vezes. Sem erro, sem log, fazendo
    // exatamente o que a tela mandou.
    const contato = '5511900000014'
    const conversa = await conversaComContato(contato)
    vi.mocked(sendReply).mockResolvedValueOnce({ status: 'ambiguous', reason: 'falha_de_rede' })

    const r = await sendOperatorReply({ tenantId, tenantSlug: T, contactId: contato, text: 'ok' })

    expect(r.ok).toBe(false)
    expect(r.ambiguous).toBe(true)
    expect(r.error).not.toMatch(/falhou/i)
    expect(r.error).toMatch(/pode ter sido/i)
    expect(r.error).toMatch(/confira/i)

    // A fala do operador fica registrada nos dois casos — o histórico não mente.
    const mensagens = await db.message.findMany({ where: { conversationId: conversa.id } })
    expect(mensagens).toHaveLength(1)

    await db.message.deleteMany({ where: { conversationId: conversa.id } })
    await db.conversation.delete({ where: { id: conversa.id } })
  })

  it('15. não enviado definitivo: a mensagem de falha de hoje, preservada', async () => {
    const contato = '5511900000015'
    const conversa = await conversaComContato(contato)
    vi.mocked(sendReply).mockResolvedValueOnce({
      status: 'not_sent',
      retryable: false,
      reason: 'sem_token',
    })

    const r = await sendOperatorReply({ tenantId, tenantSlug: T, contactId: contato, text: 'ok' })

    expect(r.ok).toBe(false)
    expect(r.ambiguous).toBeUndefined()
    expect(r.error).toMatch(/falhou/i)

    await db.message.deleteMany({ where: { conversationId: conversa.id } })
    await db.conversation.delete({ where: { id: conversa.id } })
  })

  it('16. enviado: sucesso, sem aviso nenhum', async () => {
    const contato = '5511900000016'
    const conversa = await conversaComContato(contato)

    const r = await sendOperatorReply({ tenantId, tenantSlug: T, contactId: contato, text: 'ok' })

    expect(r.ok).toBe(true)
    expect(r.error).toBeUndefined()

    await db.message.deleteMany({ where: { conversationId: conversa.id } })
    await db.conversation.delete({ where: { id: conversa.id } })
  })
})
