import { db } from '../db.server'
import { decideHandoff } from './handoff'
import { loadKnowledgeBase } from './knowledge.server'
import { composeAssistantResponse } from './response'
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

// Resposta segura usada quando o cliente pede humano ou toca tema sensível:
// não tenta responder pela base, só sinaliza o encaminhamento.
const SAFE_HANDOFF_REPLY =
  'Vou marcar para uma pessoa do time te ajudar com segurança. Pode me dar mais contexto enquanto isso?'

function findTenantInput(slug: string) {
  return INITIAL_TENANTS.find((tenant) => tenant.slug === slug)
}

/**
 * Orquestra o "cérebro" do Hermes para uma mensagem recebida no simulador:
 * garante tenant e conversa, salva a mensagem do usuário, faz retrieval,
 * decide handoff, compõe a resposta, persiste tudo e cria HandoffEvent quando preciso.
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
  if (input.conversationId) {
    const existing = await db.conversation.findUnique({
      where: { id: input.conversationId },
    })
    if (!existing || existing.tenantId !== tenant.id) {
      throw new Error('Conversation not found')
    }
    conversationId = existing.id
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
  }

  const userMessage = await db.message.create({
    data: { conversationId, role: 'user', content: message },
  })

  const docs = await loadKnowledgeBase(input.tenantSlug)
  const retrieved = retrieveRelevantChunks(message, docs)
  const handoff = decideHandoff({ message, retrievedCount: retrieved.length })
  const composed = composeAssistantResponse({
    tenantSlug: input.tenantSlug,
    userMessage: message,
    sources: retrieved,
  })

  // A decisão de handoff tem precedência: se ela pede humano, a conversa vai pra
  // humano mesmo que o compositor (que só olha sources) diga needsHuman: false.
  const usesSafeReply = handoff.reason === 'requested_human' || handoff.reason === 'sensitive_topic'
  const reply = usesSafeReply ? SAFE_HANDOFF_REPLY : composed.reply
  const confidence = usesSafeReply ? 0 : composed.confidence
  const sources: ProcessIncomingMessageSource[] = usesSafeReply
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

  if (handoff.needsHuman) {
    await db.conversation.update({
      where: { id: conversationId },
      data: { status: 'needs_human' },
    })
    await db.handoffEvent.create({
      data: { conversationId, reason: handoff.reason ?? 'unknown', message },
    })
  }

  return {
    conversationId,
    tenantSlug: input.tenantSlug,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    reply,
    needsHuman: handoff.needsHuman,
    handoffReason: handoff.reason,
    confidence,
    sources,
  }
}
