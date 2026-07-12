import { db } from '../db.server'
import { reportDegradation, reportSensitiveHandoff } from './alarm.server'
import { generateAttendantReply } from './attendant'
import { buildCompanyRules } from './attendant/rules'
import { safeDefaultConfig, type TenantConfig } from './attendant/tenant-config'
import { resolveTenantConfig } from './attendant/tenant-config-db.server'
import { checkBillingGate } from './billing-gate.server'
import { isHumanHandling } from './conversation-status'
import { decideHandoff } from './handoff'
import { resolveKnowledge } from './knowledge-db.server'
import { extractLeadPatch } from './lead'
import { retrieveRelevantChunks } from './retrieval'
import { resolveTenant } from './tenants.server'
import { hasDuplicateOpenTicket } from './ticket'

export type ProcessIncomingMessageInput = {
  tenantSlug: string
  message: string
  conversationId?: string
  contactId?: string
  // Canal REAL da mensagem. Além de corrigir a métrica por canal, decide o alarme:
  // handoff sensível só alarma vindo do WhatsApp — visitante anônimo da demo
  // pública não pode disparar push urgente no celular do operador.
  channel?: 'simulator' | 'whatsapp'
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
  // true quando um humano assumiu a conversa e o Hermes ficou em silêncio.
  humanHandling?: boolean
}

const HISTORY_LIMIT = 12

// Resolve o TenantConfig com fallback em camadas (estratégia C do M2.5): BANCO primeiro,
// ARQUIVO como reserva, e se nada existir/estiver válido, um default conservador (sem ações,
// escala humano) — nunca comportamento solto.
async function loadConfigSafe(slug: string): Promise<TenantConfig> {
  try {
    const config = await resolveTenantConfig(slug)
    if (config) {
      return config
    }
    console.error(`[hermes] TenantConfig ausente para "${slug}" — usando default seguro`)
  } catch (error) {
    console.error(`[hermes] TenantConfig inválido para "${slug}" — usando default seguro`, error)
  }
  return safeDefaultConfig(slug)
}

/**
 * Orquestra o "balcão" do Hermes para uma mensagem recebida. O comportamento é
 * código único; o que muda por empresa vem do TenantConfig (regras, base, tools,
 * guard-rails, escalação) — aplicado determinísticamente aqui, nunca confiado ao
 * prompt. O "cérebro" (atendente IA) é plugável (ver `app/lib/attendant`).
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

  // Tenant vem do BANCO (fonte de verdade) — um cliente novo funciona só existindo
  // no banco, sem redeploy. Seeds conhecidos são criados on-demand; slug de fora
  // é rejeitado (não cria sujeira no banco).
  const tenant = await resolveTenant(input.tenantSlug)
  if (!tenant) {
    throw new Error(`Unknown tenant: ${input.tenantSlug}`)
  }
  const config = await loadConfigSafe(input.tenantSlug)

  // Conversa: reutiliza a informada (validando dono) ou resolve pela IDENTIDADE
  // do contato. No WhatsApp a identidade é o número (contactId) e a mensagem chega
  // SEM conversationId — então, se este contato já tem uma conversa ativa, seguimos
  // nela (preservando histórico e lead). Só abrimos conversa nova para um contato
  // novo ou quando a anterior foi encerrada. É isto que faz o Hermes LEMBRAR de
  // quem volta, em vez de tratar cada retorno como um estranho.
  let conversationId: string
  let contactId: string
  let conversationStatus: string
  if (input.conversationId) {
    const existing = await db.conversation.findUnique({
      where: { id: input.conversationId },
    })
    if (!existing || existing.tenantId !== tenant.id) {
      throw new Error('Conversation not found')
    }
    conversationId = existing.id
    contactId = existing.contactId
    conversationStatus = existing.status
  } else {
    const contact = input.contactId ?? 'demo-user'
    const active = await db.conversation.findFirst({
      where: { tenantId: tenant.id, contactId: contact, status: { not: 'closed' } },
      orderBy: { updatedAt: 'desc' },
    })
    if (active) {
      conversationId = active.id
      contactId = active.contactId
      conversationStatus = active.status
    } else {
      const created = await db.conversation.create({
        data: {
          tenantId: tenant.id,
          channel: input.channel ?? 'simulator',
          contactId: contact,
          status: 'open',
        },
      })
      conversationId = created.id
      contactId = created.contactId
      conversationStatus = created.status
    }
  }

  // Se um humano ASSUMIU esta conversa, o Hermes se cala: registra a mensagem do
  // cliente (para o atendente ver) e devolve sem gerar resposta da IA.
  if (isHumanHandling(conversationStatus)) {
    const userMessage = await db.message.create({
      data: { conversationId, role: 'user', content: message },
    })
    await db.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })
    return {
      conversationId,
      tenantSlug: input.tenantSlug,
      userMessageId: userMessage.id,
      assistantMessageId: '',
      reply: '',
      needsHuman: true,
      handoffReason: 'human_handling',
      confidence: 0,
      sources: [],
      humanHandling: true,
    }
  }

  // Gate de cobrança: se a assinatura existe mas não está ativa (E o flag está ligado), o
  // Hermes não gasta o cérebro caro — registra a mensagem e escala pra humano (o dono resolve:
  // paga ou responde manual). Grandfathering + flag desligado por padrão garantem que pilotos/
  // legado nunca são bloqueados. Ver app/lib/billing-gate.server.ts.
  const gate = await checkBillingGate(tenant.id)
  if (!gate.allowed) {
    const userMessage = await db.message.create({
      data: { conversationId, role: 'user', content: message },
    })
    await db.conversation.update({
      where: { id: conversationId },
      data: { status: 'needs_human', updatedAt: new Date() },
    })
    return {
      conversationId,
      tenantSlug: input.tenantSlug,
      userMessageId: userMessage.id,
      assistantMessageId: '',
      reply: '',
      needsHuman: true,
      handoffReason: 'billing_inactive',
      confidence: 0,
      sources: [],
    }
  }

  // Histórico ANTES de salvar a mensagem nova: a "memória" daquele contato.
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

  // Lead determinístico (barato e confiável); o atendente pode enriquecer depois.
  const detPatch = extractLeadPatch(message)
  if (Object.keys(detPatch).length > 0) {
    await db.lead.upsert({
      where: { conversationId },
      create: { tenantId: tenant.id, conversationId, ...detPatch, stage: 'novo' },
      update: { ...detPatch },
    })
  }

  // Guard-rail determinístico ANTES do cérebro — e com CURTO-CIRCUITO: pedido
  // explícito de humano e tema sensível já decidem a resposta segura, então não
  // pagamos a latência/custo do LLM nem executamos efeitos (lead/chamado) de uma
  // proposta cuja resposta o cliente nunca veria.
  const docs = await resolveKnowledge(config.slug, config.knowledge.sourceDir)
  const retrieved = retrieveRelevantChunks(message, docs)
  const guard = decideHandoff({
    message,
    retrievedCount: retrieved.length,
    extraSensitiveTriggers: config.escalationPolicy.triggers,
  })
  const guardForcesSafe = guard.reason === 'requested_human' || guard.reason === 'sensitive_topic'
  if (guardForcesSafe) {
    // Tema sensível não escala em silêncio: num tenant de saúde isso pode ser uma
    // emergência esperando na fila. Push no celular do operador (best-effort) —
    // SÓ do canal real: a demo pública é anônima e viraria botão de spam urgente.
    if (guard.reason === 'sensitive_topic' && input.channel === 'whatsapp') {
      void reportSensitiveHandoff(input.tenantSlug)
    }
    const reply = config.escalationPolicy.humanMessage
    const assistantMessage = await db.message.create({
      data: {
        conversationId,
        role: 'assistant',
        content: reply,
        confidence: 0,
        sourcesJson: JSON.stringify([]),
      },
    })
    await db.conversation.update({
      where: { id: conversationId },
      data: { status: 'needs_human' },
    })
    await db.handoffEvent.create({
      data: { conversationId, reason: guard.reason ?? 'unknown', message },
    })
    return {
      conversationId,
      tenantSlug: input.tenantSlug,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      reply,
      needsHuman: true,
      handoffReason: guard.reason,
      confidence: 0,
      sources: [],
    }
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

  // Contexto, regras e tools derivados do TenantConfig.
  const companyRules = buildCompanyRules(config)
  const enabledTools = config.tools
    .filter((tool) => tool.enabled)
    .map((tool) => ({ name: tool.name, limits: tool.limits }))

  // O cérebro: atendente IA plugável. A saída já vem validada (com a policy do
  // tenant) e com fallback seguro se o provider falhar.
  const decision = await generateAttendantReply(
    {
      tenant: { slug: tenant.slug, name: config.businessProfile.name },
      companyRules,
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
    },
    {
      policy: {
        extraForbiddenClaims: config.guardrails.neverPromise,
        outOfScope: config.guardrails.outOfScope,
        tools: enabledTools,
      },
    },
  )

  // Alarme: se o cérebro CAIU no fallback (provider/validação), o cliente recebeu a
  // resposta genérica. Avisa o operador (best-effort) — não é escalação normal.
  if (
    decision.handoffReason === 'provider_error' ||
    decision.handoffReason === 'validacao_falhou'
  ) {
    void reportDegradation(decision.handoffReason)
  }

  // Enriquecimento de lead sugerido pelo atendente (precedência sobre o determinístico).
  if (decision.leadPatch && Object.keys(decision.leadPatch).length > 0) {
    await db.lead.upsert({
      where: { conversationId },
      create: { tenantId: tenant.id, conversationId, ...decision.leadPatch, stage: 'novo' },
      update: { ...decision.leadPatch },
    })
  }

  // Ação proposta pelo atendente: o balcão executa (a IA não toca o banco). O
  // validador já garantiu que a ação é de uma tool habilitada para este tenant.
  // Dedup: não reabre um chamado que já cobre o mesmo problema — evita duplicar
  // quando o cliente reforça o pedido em mensagens seguidas (problemas distintos
  // continuam gerando chamados distintos).
  if (decision.action?.type === 'abrir_chamado') {
    // Busca TODOS os chamados abertos do contato — não a janela de 10 usada no
    // contexto do LLM —, senão um chamado antigo ainda em aberto escaparia do dedup.
    const openTickets = await db.ticket.findMany({
      where: { tenantId: tenant.id, contactId, status: { in: ['aberto', 'em_andamento'] } },
      select: { subject: true },
    })
    const openSubjects = openTickets.map((row) => row.subject)
    if (!hasDuplicateOpenTicket(decision.action.subject, openSubjects)) {
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
  }

  // Daqui pra baixo o guard não interfere (o curto-circuito acima já tratou os
  // casos forçados): a decisão de escalar é do cérebro validado.
  const needsHuman = decision.needsHuman
  const handoffReason = needsHuman ? (decision.handoffReason ?? 'unknown') : undefined
  const reply = decision.reply
  const confidence = decision.confidence
  const sources: ProcessIncomingMessageSource[] = retrieved.map((chunk) => ({
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

  // Marca atividade na conversa (e o status, quando escala). Sem tocar o updatedAt
  // aqui, ele só avançaria no handoff — e a resolução de identidade (reusar a
  // conversa ativa do contato), a ordem da fila do atendente e a "conversa ativa"
  // do dossiê leriam um timestamp congelado, pegando a conversa errada quando o
  // contato tem mais de uma não-fechada.
  await db.conversation.update({
    where: { id: conversationId },
    data: needsHuman ? { status: 'needs_human' } : { updatedAt: new Date() },
  })
  if (needsHuman) {
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
