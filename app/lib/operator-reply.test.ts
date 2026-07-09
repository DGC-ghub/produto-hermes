import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { sendOperatorReply } from './operator-reply.server'
import { ensureTenant } from './tenants.server'

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
})
