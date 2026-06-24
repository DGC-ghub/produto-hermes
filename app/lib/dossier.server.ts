import { db } from '../db.server'

// O "dossiê" é a ficha consolidada de um CONTATO (não de uma conversa): quem é,
// o que já fez e por que chegou ao humano. É o que o Hermes entrega ao atendente
// no encaminhamento — o "copiloto" que evita o humano garimpar o banco.

export type DossierLead = {
  name: string | null
  phone: string | null
  neighborhood: string | null
  need: string | null
  urgency: string | null
  stage: string
}

export type DossierTicket = {
  subject: string
  status: string
  category: string | null
  createdAt: string
}

export type DossierMessage = { id: string; role: string; content: string }

export type DossierPriority = 'alta' | 'media' | 'baixa'

export type ContactDossier = {
  contactId: string
  tenantSlug: string
  tenantName: string
  status: string
  handoffReason: string | null
  lead: DossierLead | null
  tickets: DossierTicket[]
  openTicketCount: number
  recentMessages: DossierMessage[]
  headline: string
  priority: DossierPriority
}

export type ComposeDossierInput = {
  contactId: string
  tenantSlug: string
  tenantName: string
  status: string
  handoffReason: string | null
  lead: DossierLead | null
  tickets: DossierTicket[]
  recentMessages: DossierMessage[]
}

const HEADLINE_NEED_MAX = 40
const OPEN_TICKET_STATUSES = new Set(['aberto', 'em_andamento'])
const HIGH_PRIORITY_REASONS = new Set(['requested_human', 'sensitive_topic'])

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * Monta o dossiê a partir de dados já carregados. Função PURA e determinística
 * (sem banco/fs/LLM) — é aqui que mora a regra de "o que o atendente vê primeiro":
 * a `headline` de uma linha e a `priority` para ordenar a fila.
 */
export function composeDossier(input: ComposeDossierInput): ContactDossier {
  const openTicketCount = input.tickets.filter((t) => OPEN_TICKET_STATUSES.has(t.status)).length
  const isUrgent = input.lead?.urgency === 'alta'

  // Prioridade: pedido de humano / tema sensível ou urgência alta -> alta;
  // havendo ficha ou chamado em aberto -> média; caso contrário -> baixa.
  let priority: DossierPriority = 'baixa'
  if ((input.handoffReason && HIGH_PRIORITY_REASONS.has(input.handoffReason)) || isUrgent) {
    priority = 'alta'
  } else if (input.lead || openTicketCount > 0) {
    priority = 'media'
  }

  // Headline: junta só o que existe, na ordem que um atendente leria.
  const parts: string[] = []
  parts.push(input.lead?.name?.trim() || `Contato ${input.contactId}`)
  if (input.lead?.neighborhood) parts.push(input.lead.neighborhood)
  if (input.lead?.need) parts.push(truncate(input.lead.need, HEADLINE_NEED_MAX))
  if (isUrgent) parts.push('⚠ urgente')
  if (openTicketCount > 0) {
    parts.push(
      `${openTicketCount} chamado${openTicketCount > 1 ? 's' : ''} aberto${openTicketCount > 1 ? 's' : ''}`,
    )
  }

  return {
    contactId: input.contactId,
    tenantSlug: input.tenantSlug,
    tenantName: input.tenantName,
    status: input.status,
    handoffReason: input.handoffReason,
    lead: input.lead,
    tickets: input.tickets,
    openTicketCount,
    recentMessages: input.recentMessages,
    headline: parts.join(' · '),
    priority,
  }
}

const RECENT_MESSAGES_LIMIT = 12

/**
 * Carrega o dossiê de um contato a partir do banco. Server-side (usa `db`).
 * Reúne TODAS as conversas daquele (tenant, contato) — a identidade é o contato,
 * não a conversa — e consolida lead, chamados e histórico recente.
 */
export async function getContactDossier(
  tenantSlug: string,
  contactId: string,
): Promise<ContactDossier | null> {
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } })
  if (!tenant) {
    return null
  }

  const conversations = await db.conversation.findMany({
    where: { tenantId: tenant.id, contactId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true },
  })
  if (conversations.length === 0) {
    return null
  }
  const conversationIds = conversations.map((c) => c.id)
  const activeStatus = conversations[0].status

  const [leadRow, ticketRows, messageRows, handoffRow] = await Promise.all([
    db.lead.findFirst({
      where: { conversationId: { in: conversationIds } },
      orderBy: { updatedAt: 'desc' },
    }),
    db.ticket.findMany({
      where: { tenantId: tenant.id, contactId },
      orderBy: { createdAt: 'desc' },
    }),
    db.message.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: { createdAt: 'desc' },
      take: RECENT_MESSAGES_LIMIT,
      select: { id: true, role: true, content: true },
    }),
    db.handoffEvent.findFirst({
      where: { conversationId: { in: conversationIds } },
      orderBy: { createdAt: 'desc' },
      select: { reason: true },
    }),
  ])

  return composeDossier({
    contactId,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    status: activeStatus,
    handoffReason: handoffRow?.reason ?? null,
    lead: leadRow
      ? {
          name: leadRow.name,
          phone: leadRow.phone,
          neighborhood: leadRow.neighborhood,
          need: leadRow.need,
          urgency: leadRow.urgency,
          stage: leadRow.stage,
        }
      : null,
    tickets: ticketRows.map((t) => ({
      subject: t.subject,
      status: t.status,
      category: t.category,
      createdAt: t.createdAt.toISOString(),
    })),
    recentMessages: messageRows
      .reverse()
      .map((m) => ({ id: m.id, role: m.role, content: m.content })),
  })
}

export type HandoffQueueItem = {
  conversationId: string
  contactId: string
  tenantSlug: string
  tenantName: string
  headline: string
  priority: DossierPriority
  handoffReason: string | null
  updatedAt: string
}

const PRIORITY_RANK: Record<DossierPriority, number> = { alta: 0, media: 1, baixa: 2 }
const QUEUE_LIMIT = 50

/**
 * A FILA do atendente: conversas que precisam de humano, já com headline e
 * prioridade do dossiê, ordenadas por prioridade e depois por mais recente.
 * Server-side (usa `db`).
 */
export async function getHandoffQueue(): Promise<HandoffQueueItem[]> {
  const conversations = await db.conversation.findMany({
    where: { status: 'needs_human' },
    orderBy: { updatedAt: 'desc' },
    take: QUEUE_LIMIT,
    include: {
      tenant: { select: { slug: true, name: true } },
      lead: true,
      handoffEvents: { orderBy: { createdAt: 'desc' }, take: 1, select: { reason: true } },
    },
  })

  const items = await Promise.all(
    conversations.map(async (conversation) => {
      const openTicketCount = await db.ticket.count({
        where: {
          tenantId: conversation.tenantId,
          contactId: conversation.contactId,
          status: { in: ['aberto', 'em_andamento'] },
        },
      })
      const dossier = composeDossier({
        contactId: conversation.contactId,
        tenantSlug: conversation.tenant.slug,
        tenantName: conversation.tenant.name,
        status: conversation.status,
        handoffReason: conversation.handoffEvents[0]?.reason ?? null,
        lead: conversation.lead
          ? {
              name: conversation.lead.name,
              phone: conversation.lead.phone,
              neighborhood: conversation.lead.neighborhood,
              need: conversation.lead.need,
              urgency: conversation.lead.urgency,
              stage: conversation.lead.stage,
            }
          : null,
        // tickets entram só pela contagem aqui (a fila não precisa do detalhe).
        tickets: Array.from({ length: openTicketCount }, () => ({
          subject: '',
          status: 'aberto',
          category: null,
          createdAt: '',
        })),
        recentMessages: [],
      })
      return {
        conversationId: conversation.id,
        contactId: conversation.contactId,
        tenantSlug: conversation.tenant.slug,
        tenantName: conversation.tenant.name,
        headline: dossier.headline,
        priority: dossier.priority,
        handoffReason: dossier.handoffReason,
        updatedAt: conversation.updatedAt.toISOString(),
      }
    }),
  )

  return items.sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    return byPriority !== 0 ? byPriority : b.updatedAt.localeCompare(a.updatedAt)
  })
}
