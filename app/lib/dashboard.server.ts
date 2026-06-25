import { db } from '../db.server'

export type DashboardSummary = {
  totalConversations: number
  totalMessages: number
  totalLeads: number
  needsHumanConversations: number
}

export type DashboardConversation = {
  id: string
  tenantSlug: string
  tenantName: string
  contactId: string
  status: string
  messageCount: number
  lastMessagePreview: string | null
  updatedAt: string
}

export type DashboardLead = {
  id: string
  tenantSlug: string
  tenantName: string
  name: string | null
  phone: string | null
  neighborhood: string | null
  need: string | null
  urgency: string | null
  stage: string
  createdAt: string
}

export type DashboardData = {
  summary: DashboardSummary
  conversations: DashboardConversation[]
  leads: DashboardLead[]
}

const RECENT_LIMIT = 20
const PREVIEW_MAX_CHARS = 120

/**
 * Lê os dados do painel (read-only) a partir do banco, ESCOPADOS pelo tenant do
 * operador — cada empresa só vê os próprios números. Server-side — usa `db`.
 * Não importar em componente React.
 */
export async function getDashboardData(tenantId: string): Promise<DashboardData> {
  const [totalConversations, totalMessages, totalLeads, needsHumanConversations] =
    await Promise.all([
      db.conversation.count({ where: { tenantId } }),
      db.message.count({ where: { conversation: { tenantId } } }),
      db.lead.count({ where: { tenantId } }),
      db.conversation.count({ where: { status: 'needs_human', tenantId } }),
    ])

  const conversationRows = await db.conversation.findMany({
    where: { tenantId },
    orderBy: { updatedAt: 'desc' },
    take: RECENT_LIMIT,
    include: {
      tenant: { select: { slug: true, name: true } },
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true } },
    },
  })

  const leadRows = await db.lead.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: RECENT_LIMIT,
    include: { tenant: { select: { slug: true, name: true } } },
  })

  return {
    summary: { totalConversations, totalMessages, totalLeads, needsHumanConversations },
    conversations: conversationRows.map((conversation) => ({
      id: conversation.id,
      tenantSlug: conversation.tenant.slug,
      tenantName: conversation.tenant.name,
      contactId: conversation.contactId,
      status: conversation.status,
      messageCount: conversation._count.messages,
      lastMessagePreview: conversation.messages[0]
        ? conversation.messages[0].content.slice(0, PREVIEW_MAX_CHARS)
        : null,
      updatedAt: conversation.updatedAt.toISOString(),
    })),
    leads: leadRows.map((lead) => ({
      id: lead.id,
      tenantSlug: lead.tenant.slug,
      tenantName: lead.tenant.name,
      name: lead.name,
      phone: lead.phone,
      neighborhood: lead.neighborhood,
      need: lead.need,
      urgency: lead.urgency,
      stage: lead.stage,
      createdAt: lead.createdAt.toISOString(),
    })),
  }
}
