import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { getDashboardData } from './dashboard.server'
import { ensureInitialTenants } from './tenants.server'

const TEST_CONTACT_ID = 'test-task-11'

async function dgcTenantId(): Promise<string> {
  const tenant = await db.tenant.findUnique({ where: { slug: 'dgc' } })
  if (!tenant) {
    throw new Error('dgc tenant missing — ensureInitialTenants should have created it')
  }
  return tenant.id
}

async function createTestConversation(status = 'open'): Promise<string> {
  const tenantId = await dgcTenantId()
  const conversation = await db.conversation.create({
    data: { tenantId, channel: 'simulator', contactId: TEST_CONTACT_ID, status },
  })
  return conversation.id
}

beforeAll(async () => {
  await ensureInitialTenants()
})

// Limpa apenas o que os testes criam (contactId controlado). Nunca apaga tenants reais.
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

describe('getDashboardData', () => {
  it('returns a numeric summary and arrays', async () => {
    const data = await getDashboardData()

    expect(typeof data.summary.totalConversations).toBe('number')
    expect(typeof data.summary.totalMessages).toBe('number')
    expect(typeof data.summary.totalLeads).toBe('number')
    expect(typeof data.summary.needsHumanConversations).toBe('number')
    expect(Array.isArray(data.conversations)).toBe(true)
    expect(Array.isArray(data.leads)).toBe(true)
  })

  it('counts a created conversation and its messages', async () => {
    const conversationId = await createTestConversation()
    await db.message.create({ data: { conversationId, role: 'user', content: 'Olá' } })
    await db.message.create({
      data: { conversationId, role: 'assistant', content: 'Oi, tudo bem?' },
    })

    const data = await getDashboardData()

    // Os registros existem no momento da query, então os totais são pelo menos os nossos.
    expect(data.summary.totalConversations).toBeGreaterThanOrEqual(1)
    expect(data.summary.totalMessages).toBeGreaterThanOrEqual(2)

    const mine = data.conversations.find((c) => c.id === conversationId)
    expect(mine).toBeDefined()
    expect(mine?.messageCount).toBe(2)
    expect(mine?.tenantSlug).toBe('dgc')
    expect(mine?.tenantName).toBe('DGC Hub')
  })

  it('increments needsHumanConversations for a needs_human conversation', async () => {
    const conversationId = await createTestConversation('needs_human')

    const data = await getDashboardData()

    expect(data.summary.needsHumanConversations).toBeGreaterThanOrEqual(1)
    const mine = data.conversations.find((c) => c.id === conversationId)
    expect(mine?.status).toBe('needs_human')
  })

  it('truncates the last message preview to 120 characters', async () => {
    const conversationId = await createTestConversation()
    const longContent = 'a'.repeat(200)
    await db.message.create({ data: { conversationId, role: 'user', content: longContent } })

    const data = await getDashboardData()

    const mine = data.conversations.find((c) => c.id === conversationId)
    expect(mine?.lastMessagePreview).toBe(longContent.slice(0, 120))
    expect(mine?.lastMessagePreview?.length).toBe(120)
  })

  it('lists a created lead', async () => {
    const conversationId = await createTestConversation()
    const tenantId = await dgcTenantId()
    const lead = await db.lead.create({
      data: { tenantId, conversationId, need: 'Trocar tela', stage: 'novo' },
    })

    const data = await getDashboardData()

    expect(data.summary.totalLeads).toBeGreaterThanOrEqual(1)
    const mine = data.leads.find((l) => l.id === lead.id)
    expect(mine).toBeDefined()
    expect(mine?.need).toBe('Trocar tela')
    expect(mine?.tenantSlug).toBe('dgc')
  })
})
