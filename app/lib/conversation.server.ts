import { db } from '../db.server'
import { reportDegradation, reportSensitiveHandoff } from './alarm.server'
import { activeProviderName, generateAttendantReply } from './attendant'
import { buildCompanyRules } from './attendant/rules'
import { safeDefaultConfig, type TenantConfig } from './attendant/tenant-config'
import { resolveTenantConfig } from './attendant/tenant-config-db.server'
import { checkBillingGate } from './billing-gate.server'
import { isHumanHandling } from './conversation-status'
import { decideHandoff } from './handoff'
import { resolveKnowledge } from './knowledge-db.server'
import { extractLeadPatch } from './lead'
import { createTimer, type Timer } from './metrics'
import { recordMessageTrace, type TraceOutcome } from './metrics.server'
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
  // Preview autenticado: executa cérebro/guard/persistência da conversa e métricas,
  // mas não cria efeitos operacionais (lead, ticket, handoff, status ou alarme).
  preview?: boolean
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
 * Contexto que a casca de medição precisa e que só é conhecido no meio do
 * caminho (o tenant é resolvido lá dentro). Preenchido pelo corpo à medida que
 * descobre; lido pela casca ao fechar o trace, inclusive quando dá exceção.
 */
type TraceContext = { tenantId?: string; conversationId?: string; outcome: TraceOutcome }

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
  const timer = createTimer()
  const ctx: TraceContext = { outcome: 'erro' }
  try {
    return await runIncomingMessage(input, timer, ctx)
  } finally {
    // Sem await: a medição não entra no caminho crítico da resposta ao cliente.
    // Sem tenant resolvido não há o que gravar (a FK exige tenant existente).
    if (ctx.tenantId) {
      void recordMessageTrace({
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        channel: input.channel ?? 'simulator',
        provider:
          ctx.outcome === 'ok' || ctx.outcome === 'fallback' ? activeProviderName() : 'nenhum',
        outcome: ctx.outcome,
        trace: timer.finish(),
      })
    }
  }
}

async function runIncomingMessage(
  input: ProcessIncomingMessageInput,
  timer: Timer,
  ctx: TraceContext,
): Promise<ProcessIncomingMessageResult> {
  const message = input.message.trim()
  if (message.length === 0) {
    throw new Error('Message is required')
  }
  const preview = input.preview === true

  // Tenant vem do BANCO (fonte de verdade) — um cliente novo funciona só existindo
  // no banco, sem redeploy. Seeds conhecidos são criados on-demand; slug de fora
  // é rejeitado (não cria sujeira no banco).
  const tenant = await timer.step('tenant', () => resolveTenant(input.tenantSlug))
  if (!tenant) {
    throw new Error(`Unknown tenant: ${input.tenantSlug}`)
  }
  ctx.tenantId = tenant.id
  const config = await timer.step('config', () => loadConfigSafe(input.tenantSlug))

  // Conversa: reutiliza a informada (validando dono) ou resolve pela IDENTIDADE
  // do contato. No WhatsApp a identidade é o número (contactId) e a mensagem chega
  // SEM conversationId — então, se este contato já tem uma conversa ativa, seguimos
  // nela (preservando histórico e lead). Só abrimos conversa nova para um contato
  // novo ou quando a anterior foi encerrada. É isto que faz o Hermes LEMBRAR de
  // quem volta, em vez de tratar cada retorno como um estranho.
  const resolved = await timer.step('conversation', async () => {
    if (input.conversationId) {
      const existing = await db.conversation.findUnique({
        where: { id: input.conversationId },
      })
      if (!existing || existing.tenantId !== tenant.id) {
        throw new Error('Conversation not found')
      }
      return { id: existing.id, contactId: existing.contactId, status: existing.status }
    }
    const contact = input.contactId ?? 'demo-user'
    const active = await db.conversation.findFirst({
      where: { tenantId: tenant.id, contactId: contact, status: { not: 'closed' } },
      orderBy: { updatedAt: 'desc' },
    })
    if (active) {
      return { id: active.id, contactId: active.contactId, status: active.status }
    }
    const created = await db.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: input.channel ?? 'simulator',
        contactId: contact,
        status: 'open',
      },
    })
    return { id: created.id, contactId: created.contactId, status: created.status }
  })
  const conversationId = resolved.id
  const contactId = resolved.contactId
  const conversationStatus = resolved.status
  ctx.conversationId = conversationId

  // Se um humano ASSUMIU esta conversa, o Hermes se cala: registra a mensagem do
  // cliente (para o atendente ver) e devolve sem gerar resposta da IA.
  if (isHumanHandling(conversationStatus) && !preview) {
    ctx.outcome = 'human_handling'
    const userMessage = await timer.step('persist_user', async () => {
      const created = await db.message.create({
        data: { conversationId, role: 'user', content: message },
      })
      await db.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      })
      return created
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
  const gate = await timer.step('billing', () => checkBillingGate(tenant.id))
  if (!gate.allowed) {
    ctx.outcome = 'billing_blocked'
    const userMessage = await timer.step('persist_user', async () => {
      const created = await db.message.create({
        data: { conversationId, role: 'user', content: message },
      })
      await db.conversation.update({
        where: { id: conversationId },
        data: preview ? { updatedAt: new Date() } : { status: 'needs_human' },
      })
      return created
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
  const priorMessages = await timer.step('history', () =>
    db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { role: true, content: true },
    }),
  )
  const history = priorMessages
    .reverse()
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        m.role === 'user' || m.role === 'assistant',
    )
    .map((m) => ({ role: m.role, content: m.content }))

  const userMessage = await timer.step('persist_user', async () => {
    const created = await db.message.create({
      data: { conversationId, role: 'user', content: message },
    })

    // Lead determinístico (barato e confiável); o atendente pode enriquecer depois.
    const detPatch = extractLeadPatch(message)
    if (!preview && Object.keys(detPatch).length > 0) {
      await db.lead.upsert({
        where: { conversationId },
        create: { tenantId: tenant.id, conversationId, ...detPatch, stage: 'novo' },
        update: { ...detPatch },
      })
    }
    return created
  })

  // Guard-rail determinístico ANTES do cérebro — e com CURTO-CIRCUITO: pedido
  // explícito de humano e tema sensível já decidem a resposta segura, então não
  // pagamos a latência/custo do LLM nem executamos efeitos (lead/chamado) de uma
  // proposta cuja resposta o cliente nunca veria.
  const docs = await timer.step('knowledge', () =>
    resolveKnowledge(config.slug, config.knowledge.sourceDir),
  )
  const retrieved = timer.stepSync('retrieval', () => retrieveRelevantChunks(message, docs))
  const guard = timer.stepSync('guard', () =>
    decideHandoff({
      message,
      retrievedCount: retrieved.length,
      extraSensitiveTriggers: config.escalationPolicy.triggers,
    }),
  )
  const guardForcesSafe = guard.reason === 'requested_human' || guard.reason === 'sensitive_topic'
  if (guardForcesSafe) {
    // Tema sensível não escala em silêncio: num tenant de saúde isso pode ser uma
    // emergência esperando na fila. Push no celular do operador (best-effort) —
    // SÓ do canal real: a demo pública é anônima e viraria botão de spam urgente.
    if (guard.reason === 'sensitive_topic' && input.channel === 'whatsapp') {
      void reportSensitiveHandoff(input.tenantSlug)
    }
    ctx.outcome = 'guard_handoff'
    const reply = config.escalationPolicy.humanMessage
    const assistantMessage = await timer.step('persist_reply', async () => {
      const created = await db.message.create({
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
        data: preview ? { updatedAt: new Date() } : { status: 'needs_human' },
      })
      if (!preview) {
        await db.handoffEvent.create({
          data: { conversationId, reason: guard.reason ?? 'unknown', message },
        })
      }
      return created
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

  const { currentLead, myTickets } = await timer.step('context', async () => {
    // Preview simula um contato novo sem ler nem misturar dados operacionais do tenant.
    if (preview) {
      return { currentLead: null, myTickets: [] }
    }
    const lead = await db.lead.findUnique({ where: { conversationId } })

    // Chamados SÓ deste contato (isolamento determinístico — o LLM nunca vê os de outros).
    const ticketRows = await db.ticket.findMany({
      where: { tenantId: tenant.id, contactId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { subject: true, status: true },
    })
    return {
      currentLead: lead,
      myTickets: ticketRows.map((row) => ({ subject: row.subject, status: row.status })),
    }
  })

  // Contexto, regras e tools derivados do TenantConfig.
  const companyRules = buildCompanyRules(config)
  const enabledTools = config.tools
    .filter((tool) => tool.enabled)
    .map((tool) => ({ name: tool.name, limits: tool.limits }))

  // O cérebro: atendente IA plugável. A saída já vem validada (com a policy do
  // tenant) e com fallback seguro se o provider falhar.
  const decision = await timer.step('brain', () =>
    generateAttendantReply(
      {
        tenant: { slug: tenant.slug, name: config.businessProfile.name },
        companyRules,
        enabledTools: enabledTools.map((tool) => tool.name),
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
    ),
  )

  // Alarme: se o cérebro CAIU no fallback (provider/validação), o cliente recebeu a
  // resposta genérica. Avisa o operador (best-effort) — não é escalação normal.
  const razaoDegradacao =
    decision.handoffReason === 'provider_error' || decision.handoffReason === 'validacao_falhou'
      ? decision.handoffReason
      : null
  if (razaoDegradacao && !preview) {
    void reportDegradation(razaoDegradacao)
  }
  // Separar 'fallback' de 'ok' na medição é o que permite ler o p95 do motor SADIO:
  // uma queda do provider responde em 200ms e mascararia a lentidão real na média.
  ctx.outcome = razaoDegradacao ? 'fallback' : 'ok'

  await timer.step('effects', async () => {
    if (preview) {
      return
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
  })

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

  const assistantMessage = await timer.step('persist_reply', async () => {
    const created = await db.message.create({
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
      data: needsHuman && !preview ? { status: 'needs_human' } : { updatedAt: new Date() },
    })
    if (needsHuman && !preview) {
      await db.handoffEvent.create({
        data: { conversationId, reason: handoffReason ?? 'unknown', message },
      })
    }
    return created
  })

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
