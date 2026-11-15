import { createHmac } from 'node:crypto'
import { db } from '../db.server'
import { DEMO_TENANT_SLUGS } from './tenants.server'

// LGPD (DGC-91): guarda por prazo e exclusão de verdade (nada de anonimizar).
//
// Escolha: ORDEM EXPLÍCITA dentro de uma transação em lote (`$transaction([...])`: a regra
// de app/lib/fronteira-transacao.test.ts proíbe helper async recebendo `tx`), e não `onDelete: Cascade` no schema.
// Motivo: no SQLite, mudar a FK exige recriar as tabelas (migration arriscada num banco de
// produção); a ordem explícita não mexe no schema e deixa a contagem do que foi apagado.
//
// O relatório devolvido NUNCA leva conteúdo de mensagem nem telefone: só contagens, ids
// internos e data. O contactId (que pode ser o telefone) sai como hash curto.

export const DEFAULT_RETENTION_DAYS = 90
/** Prazo curto das conversas da demo pública (visitantes anônimos). */
export const DEMO_RETENTION_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export type Counts = Record<string, number>

export type ApagadoRelatorio = {
  operacao: 'retencao' | 'apagar-contato' | 'apagar-tenant'
  dryRun: boolean
  data: string
  tenant: string
  /** Só em apagar-contato: hash do contato, nunca o contactId. */
  contatoHash?: string
  prazoDias?: number
  contagens: Counts
  /** Ids internos (cuid) das conversas/leads/chamados apagados. Sem conteúdo. */
  ids: { conversas: string[]; leads: string[]; chamados: string[] }
}

/** Prazo efetivo de um tenant: demo pública usa 7 dias; os demais, o campo do tenant. */
export function retentionFor(tenant: { slug: string; retentionDays: number }): number {
  const days =
    Number.isInteger(tenant.retentionDays) && tenant.retentionDays > 0
      ? tenant.retentionDays
      : DEFAULT_RETENTION_DAYS
  return DEMO_TENANT_SLUGS.includes(tenant.slug) ? Math.min(days, DEMO_RETENTION_DAYS) : days
}

/**
 * Hash curto e estável do contato, para o registro não carregar telefone.
 * HMAC com segredo (LGPD_HASH_SECRET): SHA-256 puro de telefone se reverte por força bruta.
 * Falha fechado: sem o segredo, não gera hash (e a exclusão nem começa).
 */
export function hashContato(contactId: string): string {
  const secret = process.env.LGPD_HASH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('LGPD_HASH_SECRET ausente ou curto demais (mínimo 16 caracteres)')
  }
  return createHmac('sha256', secret).update(contactId).digest('hex').slice(0, 12)
}

/** O SQLite limita parâmetros por consulta: todo `in: [...]` vai em blocos. */
const BLOCO = 500
function blocos<T>(ids: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += BLOCO) out.push(ids.slice(i, i + BLOCO))
  return out
}

type Alvo = {
  conversationIds: string[]
  leadIds: string[]
  ticketIds: string[]
  /** Leads sem conversa e chamados são selecionados por ids; webhook por filtro. */
  webhookWhere: object
  tenantId: string
  /** true (apagar-tenant): todas as medições do tenant; false: só as das conversas alvo. */
  traceDoTenantInteiro: boolean
}

async function contar(alvo: Alvo): Promise<Counts> {
  let mensagens = 0
  let eventosHandoff = 0
  let medicoes = 0
  for (const b of blocos(alvo.conversationIds)) {
    const conv = { in: b }
    mensagens += await db.message.count({ where: { conversationId: conv } })
    eventosHandoff += await db.handoffEvent.count({ where: { conversationId: conv } })
    if (!alvo.traceDoTenantInteiro) {
      medicoes += await db.messageTrace.count({
        where: { tenantId: alvo.tenantId, conversationId: conv },
      })
    }
  }
  if (alvo.traceDoTenantInteiro) {
    medicoes = await db.messageTrace.count({ where: { tenantId: alvo.tenantId } })
  }
  return {
    mensagens,
    eventosHandoff,
    conversas: alvo.conversationIds.length,
    leads: alvo.leadIds.length,
    chamados: alvo.ticketIds.length,
    eventosWebhook: await db.webhookEvent.count({ where: alvo.webhookWhere }),
    medicoes,
  }
}

/**
 * Operações de exclusão, NA ORDEM (filhos antes dos pais), em blocos de ids.
 * Só monta; quem executa é o lote (`$transaction`).
 */
function operacoesDeApagar(alvo: Alvo) {
  const ops = []
  for (const b of blocos(alvo.conversationIds)) {
    const conv = { in: b }
    ops.push(
      db.message.deleteMany({ where: { conversationId: conv } }),
      db.handoffEvent.deleteMany({ where: { conversationId: conv } }),
    )
    if (!alvo.traceDoTenantInteiro) {
      ops.push(
        db.messageTrace.deleteMany({ where: { tenantId: alvo.tenantId, conversationId: conv } }),
      )
    }
  }
  for (const b of blocos(alvo.leadIds)) ops.push(db.lead.deleteMany({ where: { id: { in: b } } }))
  for (const b of blocos(alvo.ticketIds)) {
    ops.push(db.ticket.deleteMany({ where: { id: { in: b } } }))
  }
  if (alvo.traceDoTenantInteiro) {
    ops.push(db.messageTrace.deleteMany({ where: { tenantId: alvo.tenantId } }))
  }
  ops.push(db.webhookEvent.deleteMany({ where: alvo.webhookWhere }))
  for (const b of blocos(alvo.conversationIds)) {
    ops.push(db.conversation.deleteMany({ where: { id: { in: b } } }))
  }
  return ops
}

/** Quais chaves do webhook pertencem ao tenant (número Meta ou sessão Baileys). */
async function chavesWebhook(tenantId: string) {
  const numeros = await db.whatsappNumber.findMany({
    where: { tenantId },
    select: { phoneNumberId: true },
  })
  const sessoes = await db.channelSession.findMany({ where: { tenantId }, select: { id: true } })
  return {
    OR: [
      { phoneNumberId: { in: numeros.map((n) => n.phoneNumberId) } },
      { channelSessionId: { in: sessoes.map((s) => s.id) } },
    ],
  }
}

function relatorio(
  base: Omit<ApagadoRelatorio, 'data' | 'ids' | 'contagens'>,
  alvo: Alvo,
  contagens: Counts,
  now: Date,
): ApagadoRelatorio {
  return {
    ...base,
    data: now.toISOString(),
    contagens,
    ids: { conversas: alvo.conversationIds, leads: alvo.leadIds, chamados: alvo.ticketIds },
  }
}

/**
 * Rotina diária: apaga o que passou do prazo de cada tenant. A última atividade da
 * conversa é a mensagem mais recente (ou a própria conversa, se não tiver mensagem).
 * `dryRun` só conta, sem apagar.
 */
export type PurgeResultado = {
  relatorios: ApagadoRelatorio[]
  /** Tenants que falharam (só slug e tipo do erro, nunca dados). Os demais seguem. */
  erros: { tenant: string; erro: string }[]
}

/**
 * Cada tenant é processado isolado: `onRelatorio` roda logo após o tenant terminar (para
 * gravar o registro antes de seguir) e uma falha num tenant não impede os outros.
 */
export async function purgeExpired(opts: {
  now?: Date
  dryRun?: boolean
  onRelatorio?: (rel: ApagadoRelatorio) => void | Promise<void>
}): Promise<PurgeResultado> {
  const now = opts.now ?? new Date()
  const dryRun = opts.dryRun ?? false
  const tenants = await db.tenant.findMany({
    select: { id: true, slug: true, retentionDays: true },
  })
  const out: ApagadoRelatorio[] = []
  const erros: PurgeResultado['erros'] = []
  for (const tenant of tenants) {
    try {
      const prazoDias = retentionFor(tenant)
      const cutoff = new Date(now.getTime() - prazoDias * DAY_MS)
      const conversas = await db.conversation.findMany({
        where: {
          tenantId: tenant.id,
          updatedAt: { lt: cutoff },
          messages: { none: { createdAt: { gte: cutoff } } },
        },
        select: { id: true, lead: { select: { id: true } } },
      })
      const conversationIds = conversas.map((c) => c.id)
      const leadsSoltos = await db.lead.findMany({
        where: { tenantId: tenant.id, conversationId: null, updatedAt: { lt: cutoff } },
        select: { id: true },
      })
      const chamados = await db.ticket.findMany({
        where: { tenantId: tenant.id, updatedAt: { lt: cutoff } },
        select: { id: true },
      })
      const alvo: Alvo = {
        conversationIds,
        leadIds: [
          ...conversas.flatMap((c) => (c.lead ? [c.lead.id] : [])),
          ...leadsSoltos.map((l) => l.id),
        ],
        ticketIds: chamados.map((t) => t.id),
        // Só o que já terminou: não mexe na fila do webhook (pending/processing).
        webhookWhere: {
          AND: [
            await chavesWebhook(tenant.id),
            { createdAt: { lt: cutoff }, status: { in: ['done', 'failed'] } },
          ],
        },
        tenantId: tenant.id,
        traceDoTenantInteiro: false,
      }
      const contagens = await contar(alvo)
      if (!dryRun) await db.$transaction([...operacoesDeApagar(alvo)])
      const rel = relatorio(
        { operacao: 'retencao', dryRun, tenant: tenant.slug, prazoDias },
        alvo,
        contagens,
        now,
      )
      out.push(rel)
      await opts.onRelatorio?.(rel)
    } catch (e) {
      // Só o tipo do erro: a mensagem do Prisma pode carregar valores.
      erros.push({ tenant: tenant.slug, erro: e instanceof Error ? e.name : 'erro' })
    }
  }
  return { relatorios: out, erros }
}

/** Exclusão por contato: só as coisas daquele contato naquele tenant. */
export async function deleteContact(opts: {
  tenantSlug: string
  contactId: string
  dryRun?: boolean
  now?: Date
}): Promise<ApagadoRelatorio> {
  const now = opts.now ?? new Date()
  const dryRun = opts.dryRun ?? true
  if (!opts.contactId.trim()) throw new Error('contactId vazio')
  const tenant = await db.tenant.findUnique({ where: { slug: opts.tenantSlug } })
  if (!tenant) throw new Error(`Tenant não encontrado: ${opts.tenantSlug}`)
  const conversas = await db.conversation.findMany({
    where: { tenantId: tenant.id, contactId: opts.contactId },
    select: { id: true, lead: { select: { id: true } } },
  })
  const chamados = await db.ticket.findMany({
    where: { tenantId: tenant.id, contactId: opts.contactId },
    select: { id: true },
  })
  const conversationIds = conversas.map((c) => c.id)
  const alvo: Alvo = {
    conversationIds,
    leadIds: conversas.flatMap((c) => (c.lead ? [c.lead.id] : [])),
    ticketIds: chamados.map((t) => t.id),
    webhookWhere: {
      AND: [
        await chavesWebhook(tenant.id),
        {
          OR: [{ contactId: opts.contactId }, { remoteJid: { startsWith: `${opts.contactId}@` } }],
        },
      ],
    },
    tenantId: tenant.id,
    traceDoTenantInteiro: false,
  }
  // Antes de apagar: sem LGPD_HASH_SECRET falha fechado, sem ter apagado nada.
  const contatoHash = hashContato(opts.contactId)
  const contagens = await contar(alvo)
  if (!dryRun) await db.$transaction([...operacoesDeApagar(alvo)])
  return relatorio(
    { operacao: 'apagar-contato', dryRun, tenant: tenant.slug, contatoHash },
    alvo,
    contagens,
    now,
  )
}

/**
 * Exclusão da empresa inteira (fim de contrato): conversas e tudo que pende do tenant,
 * inclusive a linha do Tenant. Contas de login (Account) são preservadas: podem ter
 * vínculo com outra empresa; só o vínculo (Membership) deste tenant sai.
 */
export async function deleteTenant(opts: {
  tenantSlug: string
  dryRun?: boolean
  now?: Date
}): Promise<ApagadoRelatorio> {
  const now = opts.now ?? new Date()
  const dryRun = opts.dryRun ?? true
  const tenant = await db.tenant.findUnique({ where: { slug: opts.tenantSlug } })
  if (!tenant) throw new Error(`Tenant não encontrado: ${opts.tenantSlug}`)
  const T = { tenantId: tenant.id }
  const conversas = await db.conversation.findMany({ where: T, select: { id: true } })
  const leads = await db.lead.findMany({ where: T, select: { id: true } })
  const chamados = await db.ticket.findMany({ where: T, select: { id: true } })
  const alvo: Alvo = {
    conversationIds: conversas.map((c) => c.id),
    leadIds: leads.map((l) => l.id),
    ticketIds: chamados.map((t) => t.id),
    webhookWhere: await chavesWebhook(tenant.id),
    tenantId: tenant.id,
    traceDoTenantInteiro: true,
  }
  const contagens = await contar(alvo)
  contagens.operadores = await db.operator.count({ where: T })
  contagens.vinculos = await db.membership.count({ where: T })
  contagens.numerosWhatsapp = await db.whatsappNumber.count({ where: T })
  contagens.sessoesCanal = await db.channelSession.count({ where: T })
  contagens.baseConhecimento = await db.knowledgeDoc.count({ where: T })
  if (!dryRun) {
    await db.$transaction([
      ...operacoesDeApagar(alvo),
      db.operator.deleteMany({ where: T }),
      db.membership.deleteMany({ where: T }),
      db.whatsappNumber.deleteMany({ where: T }),
      db.channelSession.deleteMany({ where: T }),
      // AiSetup*, Subscription, TenantConfigRecord, KnowledgeDoc: onDelete Cascade no schema.
      db.tenant.delete({ where: { id: tenant.id } }),
    ])
  }
  return relatorio({ operacao: 'apagar-tenant', dryRun, tenant: tenant.slug }, alvo, contagens, now)
}
