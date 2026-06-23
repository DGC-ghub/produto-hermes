import { db } from '../db.server'
import { generateAttendantReply } from './attendant'
import { companyRulesFor } from './attendant/rules'
import { decideHandoff } from './handoff'
import { loadKnowledgeBase } from './knowledge.server'
import { extractLeadPatch } from './lead'
import { retrieveRelevantChunks } from './retrieval'
import { ensureTenant, INITIAL_TENANTS } from './tenants.server'

export type ProcessIncomingMessageInput = {
  tenantSlug: string
  message: string
  conversationId?: string
  contactId?: string
}

export type ProcessIncomingMessageSource = {
  fileName: string
  title: string
  score: number
}

export type ProcessIncomingMessageResult = {
  conversationId: string
  tenantSlug: string
  userMessageId: string
  assistantMessageId: string
  reply: string
  needsHuman: boolean
  handoffReason?: string
  confidence: number
  sources: ProcessIncomingMessageSource[]
}

// Resposta segura usada quando a camada determinística escala (pedido de humano,
// tema sensível ou base sem match): não arrisca a fala do atendente.
const SAFE_HANDOFF_REPLY =
  'Vou marcar para uma pessoa do time te ajudar com segurança. Pode me dar mais contexto enquanto isso?'

const HISTORY_LIMIT = 12

function findTenantInput(slug: string) {
  return INITIAL_TENANTS.find((tenant) => tenant.slug === slug)
}

/**
 * Orquestra o "balcão" do Hermes para uma mensagem recebida:
 * garante tenant e conversa, salva a mensagem do usuário, monta o contexto
 * (histórico, lead, base), chama o atendente IA (já validado), aplica a camada
 * de segurança determinística, persiste tudo e cria HandoffEvent quando preciso.
 *
 * O "cérebro" agora é plugável (ver `app/lib/attendant`): o provider ativo é
 * escolhido por env (ATTENDANT_PROVIDER). Este orquestrador não sabe qual é.
 *
 * Server-side — usa o banco. Não importar em componente React.
 */
export async function processIncomingMessage(
  input: ProcessIncomingMessageInput,
): Promise<ProcessIncomingMessageResult> {
  const message = input.message.trim()
  if (message.length === 0) {
    throw new Error('Message is required')
  }

  // Para o MVP só aceitamos tenants conhecidos — evita criar sujeira no banco.
  const tenantInput = findTenantInput(input.tenantSlug)
  if (!tenantInput) {
    throw new Error(`Unknown tenant: ${input.tenantSlug}`)
  }
  const tenant = await ensureTenant(tenantInput)

  // Conversa: reutiliza a informada (validando dono) ou cria uma nova.
  let conversationId: string
  let contactId: string
  if (input.conversationId) {
    const existing = await db.conversation.findUnique({
      where: { id: input.conversationId },
    })
    if (!existing || existing.tenantId !== tenant.id) {
      throw new Error('Conversation not found')
    }
    conversationId = existing.id
    contactId = existing.contactId
  } else {
    const created = await db.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: 'simulator',
        contactId: input.contactId ?? 'demo-user',
        status: 'open',
      },
    })
    conversationId = created.id
    contactId = created.contactId
  }

  // Histórico ANTES de salvar a mensagem nova: vira a "memória" daquele contato
  // que o atendente recebe (últimas N mensagens, em ordem cronológica).
  const priorMessages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
    select: { role: true, content: true },
  })
  const history = priorMessages
    .reverse()
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        m.role === 'user' || m.role === 'assistant',
    )
    .map((m) => ({ role: m.role, content: m.content }))

  const userMessage = await db.message.create({
    data: { conversationId, role: 'user', content: message },
  })

  // Lead determinístico (barato e confiável): extrai sinais da mensagem e faz
  // upsert. Mantido como base; o atendente pode enriquecer depois.
  const detPatch = extractLeadPatch(message)
  if (Object.keys(detPatch).length > 0) {
    await db.lead.upsert({
      where: { conversationId },
      create: { tenantId: tenant.id, conversationId, ...detPatch, stage: 'novo' },
      update: { ...detPatch },
    })
  }

  const currentLead = await db.lead.findUnique({ where: { conversationId } })

  // Chamados SÓ deste contato (isolamento determinístico — o LLM nunca vê os de outros).
  const ticketRows = await db.ticket.findMany({
    where: { tenantId: tenant.id, contactId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { subject: true, status: true },
  })
  const myTickets = ticketRows.map((row) => ({ subject: row.subject, status: row.status }))

  const docs = await loadKnowledgeBase(input.tenantSlug)
  const retrieved = retrieveRelevantChunks(message, docs)
  const guard = decideHandoff({ message, retrievedCount: retrieved.length })

  // O cérebro: atendente IA plugável. A saída já vem validada (fallback seguro
  // se o provider falhar ou devolver algo inválido).
  const decision = await generateAttendantReply({
    tenant: { slug: tenant.slug, name: tenant.name },
    companyRules: companyRulesFor(input.tenantSlug),
    knowledge: retrieved.map((chunk) => ({ title: chunk.title, snippet: chunk.snippet })),
    history,
    lead: currentLead
      ? {
          name: currentLead.name,
          phone: currentLead.phone,
          neighborhood: currentLead.neighborhood,
          need: currentLead.need,
          urgency: currentLead.urgency,
        }
      : null,
    myTickets,
    message,
  })

  // Enriquecimento de lead sugerido pelo atendente (tem precedência sobre o
  // determinístico onde os campos se sobrepõem).
  if (decision.leadPatch && Object.keys(decision.leadPatch).length > 0) {
    await db.lead.upsert({
      where: { conversationId },
      create: { tenantId: tenant.id, conversationId, ...decision.leadPatch, stage: 'novo' },
      update: { ...decision.leadPatch },
    })
  }

  // Ação proposta pelo atendente: o balcão executa (a IA não toca o banco).
  // O chamado é criado para ESTE contato (contactId do canal, não da mensagem).
  if (decision.action?.type === 'abrir_chamado') {
    await db.ticket.create({
      data: {
        tenantId: tenant.id,
        contactId,
        subject: decision.action.subject,
        description: decision.action.description,
        category: decision.action.category ?? null,
      },
    })
  }

  // Camada de segurança determinística: só pedido explícito de humano e tema
  // sensível forçam a resposta segura. "Base sem match" NÃO força mais handoff —
  // a IA tem contexto além da base (chamados, histórico) e decide sozinha.
  const guardForcesSafe = guard.reason === 'requested_human' || guard.reason === 'sensitive_topic'
  const useSafeReply = guardForcesSafe
  const needsHuman = guardForcesSafe || decision.needsHuman
  const handoffReason = needsHuman
    ? guardForcesSafe
      ? guard.reason
      : (decision.handoffReason ?? 'unknown')
    : undefined
  const reply = useSafeReply ? SAFE_HANDOFF_REPLY : decision.reply
  const confidence = useSafeReply ? 0 : decision.confidence
  const sources: ProcessIncomingMessageSource[] = useSafeReply
    ? []
    : retrieved.map((chunk) => ({
        fileName: chunk.fileName,
        title: chunk.title,
        score: chunk.score,
      }))

  const assistantMessage = await db.message.create({
    data: {
      conversationId,
      role: 'assistant',
      content: reply,
      confidence,
      sourcesJson: JSON.stringify(sources),
    },
  })

  if (needsHuman) {
    await db.conversation.update({
      where: { id: conversationId },
      data: { status: 'needs_human' },
    })
    await db.handoffEvent.create({
      data: { conversationId, reason: handoffReason ?? 'unknown', message },
    })
  }

  return {
    conversationId,
    tenantSlug: input.tenantSlug,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    reply,
    needsHuman,
    handoffReason,
    confidence,
    sources,
  }
}
