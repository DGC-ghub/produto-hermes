import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { deleteContact, deleteTenant, hashContato, purgeExpired, retentionFor } from './lgpd.server'

// Dados 100% fictícios.
const NOW = new Date('2026-11-13T12:00:00Z')
const dias = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)
const SLUGS = ['zzz-lgpd-a', 'zzz-lgpd-b', 'assistencia-tecnica-demo']

async function limpar() {
  for (const slug of SLUGS) {
    const t = await db.tenant.findUnique({ where: { slug } })
    if (t) await deleteTenant({ tenantSlug: slug, dryRun: false })
  }
  await db.webhookEvent.deleteMany({ where: { messageId: { startsWith: 'zzz-lgpd' } } })
}
afterEach(limpar)

async function tenant(slug: string, retentionDays = 90) {
  return db.tenant.upsert({
    where: { slug },
    update: { retentionDays },
    create: { slug, name: slug, retentionDays },
  })
}

/** Conversa com 1 mensagem, 1 handoff e 1 lead, toda com a data `quando`. */
async function conversa(tenantId: string, contactId: string, quando: Date) {
  const c = await db.conversation.create({
    data: { tenantId, contactId, createdAt: quando, updatedAt: quando },
  })
  await db.message.create({
    data: { conversationId: c.id, role: 'user', content: 'texto ficticio', createdAt: quando },
  })
  await db.handoffEvent.create({
    data: { conversationId: c.id, reason: 'teste', createdAt: quando },
  })
  await db.lead.create({
    data: { tenantId, conversationId: c.id, name: 'Fulano Ficticio', updatedAt: quando },
  })
  return c
}

async function ticket(tenantId: string, contactId: string, quando: Date) {
  return db.ticket.create({
    data: {
      tenantId,
      contactId,
      subject: 's',
      description: 'd',
      createdAt: quando,
      updatedAt: quando,
    },
  })
}

describe('retentionFor', () => {
  it('usa o prazo do tenant e limita a demo pública a 7 dias', () => {
    expect(retentionFor({ slug: 'cliente', retentionDays: 90 })).toBe(90)
    expect(retentionFor({ slug: 'cliente', retentionDays: 30 })).toBe(30)
    expect(retentionFor({ slug: 'assistencia-tecnica-demo', retentionDays: 90 })).toBe(7)
    expect(retentionFor({ slug: 'cliente', retentionDays: 0 })).toBe(90)
  })
})

describe('purgeExpired (guarda)', () => {
  it('apaga o antigo, mantém o recente e respeita a última mensagem', async () => {
    const t = await tenant('zzz-lgpd-a')
    const velha = await conversa(t.id, 'c-velha', dias(100))
    const nova = await conversa(t.id, 'c-nova', dias(10))
    // conversa antiga mas com mensagem recente: está ativa, fica.
    const ativa = await conversa(t.id, 'c-ativa', dias(100))
    await db.message.create({
      data: { conversationId: ativa.id, role: 'user', content: 'oi de novo', createdAt: dias(2) },
    })
    const tkVelho = await ticket(t.id, 'c-velha', dias(100))
    const tkNovo = await ticket(t.id, 'c-nova', dias(5))
    const leadSolto = await db.lead.create({
      data: { tenantId: t.id, name: 'Solto', updatedAt: dias(100) },
    })

    const [rel] = (await purgeExpired({ now: NOW })).filter((r) => r.tenant === 'zzz-lgpd-a')

    expect(rel.contagens).toMatchObject({
      conversas: 1,
      mensagens: 1,
      eventosHandoff: 1,
      chamados: 1,
    })
    expect(rel.contagens.leads).toBe(2)
    expect(await db.conversation.findUnique({ where: { id: velha.id } })).toBeNull()
    expect(await db.message.count({ where: { conversationId: velha.id } })).toBe(0)
    expect(await db.handoffEvent.count({ where: { conversationId: velha.id } })).toBe(0)
    expect(await db.lead.count({ where: { conversationId: velha.id } })).toBe(0)
    expect(await db.lead.findUnique({ where: { id: leadSolto.id } })).toBeNull()
    expect(await db.ticket.findUnique({ where: { id: tkVelho.id } })).toBeNull()
    expect(await db.conversation.findUnique({ where: { id: nova.id } })).not.toBeNull()
    expect(await db.conversation.findUnique({ where: { id: ativa.id } })).not.toBeNull()
    expect(await db.message.count({ where: { conversationId: ativa.id } })).toBe(2)
    expect(await db.ticket.findUnique({ where: { id: tkNovo.id } })).not.toBeNull()
  })

  it('dry-run só conta e não apaga', async () => {
    const t = await tenant('zzz-lgpd-a')
    const velha = await conversa(t.id, 'c-velha', dias(100))
    const [rel] = (await purgeExpired({ now: NOW, dryRun: true })).filter(
      (r) => r.tenant === 'zzz-lgpd-a',
    )
    expect(rel.dryRun).toBe(true)
    expect(rel.contagens.conversas).toBe(1)
    expect(await db.conversation.findUnique({ where: { id: velha.id } })).not.toBeNull()
  })

  it('prazo por tenant: 30 dias num, 90 no outro', async () => {
    const a = await tenant('zzz-lgpd-a', 30)
    const b = await tenant('zzz-lgpd-b', 90)
    const ca = await conversa(a.id, 'x', dias(45))
    const cb = await conversa(b.id, 'x', dias(45))
    await purgeExpired({ now: NOW })
    expect(await db.conversation.findUnique({ where: { id: ca.id } })).toBeNull()
    expect(await db.conversation.findUnique({ where: { id: cb.id } })).not.toBeNull()
  })

  it('demo pública usa 7 dias mesmo com o padrão de 90', async () => {
    const demo = await tenant('assistencia-tecnica-demo', 90)
    const velha = await conversa(demo.id, 'demo-1', dias(8))
    const nova = await conversa(demo.id, 'demo-2', dias(3))
    await purgeExpired({ now: NOW })
    expect(await db.conversation.findUnique({ where: { id: velha.id } })).toBeNull()
    expect(await db.conversation.findUnique({ where: { id: nova.id } })).not.toBeNull()
  })

  it('apaga evento de webhook concluído e antigo, mas não o pendente', async () => {
    const t = await tenant('zzz-lgpd-a')
    await db.whatsappNumber.create({ data: { phoneNumberId: 'zzz-lgpd-pn', tenantId: t.id } })
    const base = { phoneNumberId: 'zzz-lgpd-pn', contactId: 'c1', text: 'ficticio' }
    await db.webhookEvent.create({
      data: { ...base, messageId: 'zzz-lgpd-done', status: 'done', createdAt: dias(100) },
    })
    await db.webhookEvent.create({
      data: { ...base, messageId: 'zzz-lgpd-pend', status: 'pending', createdAt: dias(100) },
    })
    await purgeExpired({ now: NOW })
    expect(await db.webhookEvent.findUnique({ where: { messageId: 'zzz-lgpd-done' } })).toBeNull()
    expect(
      await db.webhookEvent.findUnique({ where: { messageId: 'zzz-lgpd-pend' } }),
    ).not.toBeNull()
  })
})

describe('deleteContact', () => {
  it('apaga só aquele contato, naquele tenant; outros contatos e tenants intactos', async () => {
    const a = await tenant('zzz-lgpd-a')
    const b = await tenant('zzz-lgpd-b')
    const alvo = await conversa(a.id, '5511900000001', dias(1))
    const outroContato = await conversa(a.id, '5511900000002', dias(1))
    const outroTenant = await conversa(b.id, '5511900000001', dias(1)) // mesmo contactId!
    const tkAlvo = await ticket(a.id, '5511900000001', dias(1))
    const tkOutro = await ticket(a.id, '5511900000002', dias(1))

    const rel = await deleteContact({
      tenantSlug: 'zzz-lgpd-a',
      contactId: '5511900000001',
      dryRun: false,
      now: NOW,
    })

    expect(rel.contagens).toMatchObject({ conversas: 1, mensagens: 1, leads: 1, chamados: 1 })
    expect(await db.conversation.findUnique({ where: { id: alvo.id } })).toBeNull()
    expect(await db.ticket.findUnique({ where: { id: tkAlvo.id } })).toBeNull()
    expect(await db.conversation.findUnique({ where: { id: outroContato.id } })).not.toBeNull()
    expect(await db.ticket.findUnique({ where: { id: tkOutro.id } })).not.toBeNull()
    expect(await db.conversation.findUnique({ where: { id: outroTenant.id } })).not.toBeNull()
    expect(await db.message.count({ where: { conversationId: outroTenant.id } })).toBe(1)
  })

  it('o registro não carrega telefone nem conteúdo', async () => {
    const a = await tenant('zzz-lgpd-a')
    await conversa(a.id, '5511900000001', dias(1))
    const rel = await deleteContact({
      tenantSlug: 'zzz-lgpd-a',
      contactId: '5511900000001',
      dryRun: false,
    })
    const json = JSON.stringify(rel)
    expect(json).not.toContain('5511900000001')
    expect(json).not.toContain('texto ficticio')
    expect(json).not.toContain('Fulano')
    expect(rel.contatoHash).toBe(hashContato('5511900000001'))
  })

  it('por padrão é dry-run', async () => {
    const a = await tenant('zzz-lgpd-a')
    const c = await conversa(a.id, 'x1', dias(1))
    const rel = await deleteContact({ tenantSlug: 'zzz-lgpd-a', contactId: 'x1' })
    expect(rel.dryRun).toBe(true)
    expect(await db.conversation.findUnique({ where: { id: c.id } })).not.toBeNull()
  })

  it('tenant inexistente dá erro', async () => {
    await expect(deleteContact({ tenantSlug: 'nao-existe', contactId: 'x' })).rejects.toThrow()
  })
})

describe('deleteTenant', () => {
  it('apaga tudo da empresa e nada da outra', async () => {
    const a = await tenant('zzz-lgpd-a')
    const b = await tenant('zzz-lgpd-b')
    await conversa(a.id, 'c1', dias(1))
    await conversa(a.id, 'c2', dias(1))
    await ticket(a.id, 'c1', dias(1))
    await db.whatsappNumber.create({ data: { phoneNumberId: 'zzz-lgpd-pn-a', tenantId: a.id } })
    await db.webhookEvent.create({
      data: {
        messageId: 'zzz-lgpd-wa',
        phoneNumberId: 'zzz-lgpd-pn-a',
        contactId: 'c1',
        text: 't',
      },
    })
    await db.operator.create({
      data: { username: 'zzz-lgpd-op', passwordHash: 'x', tenantId: a.id },
    })
    const cb = await conversa(b.id, 'c1', dias(1))
    const tkb = await ticket(b.id, 'c1', dias(1))

    const dry = await deleteTenant({ tenantSlug: 'zzz-lgpd-a' })
    expect(dry.dryRun).toBe(true)
    expect(await db.tenant.findUnique({ where: { slug: 'zzz-lgpd-a' } })).not.toBeNull()

    const rel = await deleteTenant({ tenantSlug: 'zzz-lgpd-a', dryRun: false, now: NOW })
    expect(rel.contagens).toMatchObject({
      conversas: 2,
      mensagens: 2,
      chamados: 1,
      eventosWebhook: 1,
      operadores: 1,
    })
    expect(await db.tenant.findUnique({ where: { slug: 'zzz-lgpd-a' } })).toBeNull()
    expect(await db.conversation.count({ where: { tenantId: a.id } })).toBe(0)
    expect(await db.ticket.count({ where: { tenantId: a.id } })).toBe(0)
    expect(await db.webhookEvent.count({ where: { messageId: 'zzz-lgpd-wa' } })).toBe(0)
    expect(await db.operator.count({ where: { tenantId: a.id } })).toBe(0)

    expect(await db.tenant.findUnique({ where: { slug: 'zzz-lgpd-b' } })).not.toBeNull()
    expect(await db.conversation.findUnique({ where: { id: cb.id } })).not.toBeNull()
    expect(await db.message.count({ where: { conversationId: cb.id } })).toBe(1)
    expect(await db.ticket.findUnique({ where: { id: tkb.id } })).not.toBeNull()
  })
})
