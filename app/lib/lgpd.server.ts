import { createHash } from 'node:crypto'
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

/** Hash curto e estável do contato, para o registro não carregar telefone. */
export function hashContato(contactId: string): string {
  return createHash('sha256').update(contactId).digest('hex').slice(0, 12)
}

type Alvo = {
  conversationIds: string[]
  leadIds: string[]
  ticketIds: string[]
  /** Leads sem conversa e chamados são selecionados por ids; webhook por filtro. */
  webhookWhere: object
  traceWhere: object
}

async function contar(alvo: Alvo): Promise<Counts> {
  const conv = { in: alvo.conversationIds }
  return {
    mensagens: await db.message.count({ where: { conversationId: conv } }),
    eventosHandoff: await db.handoffEvent.count({ where: { conversationId: conv } }),
    conversas: alvo.conversationIds.length,
    leads: alvo.leadIds.length,
    chamados: alvo.ticketIds.length,
    eventosWebhook: await db.webhookEvent.count({ where: alvo.webhookWhere }),
    medicoes: await db.messageTrace.count({ where: alvo.traceWhere }),
  }
}

/** Operações de exclusão, NA ORDEM (filhos antes dos pais). Só monta; quem executa é o lote. */
function operacoesDeApagar(alvo: Alvo) {
  const conv = { in: alvo.conversationIds }
  return [
    db.message.deleteMany({ where: { conversationId: conv } }),
    db.handoffEvent.deleteMany({ where: { conversationId: conv } }),
    db.lead.deleteMany({ where: { id: { in: alvo.leadIds } } }),
    db.ticket.deleteMany({ where: { id: { in: alvo.ticketIds } } }),
    db.messageTrace.deleteMany({ where: alvo.traceWhere }),
    db.webhookEvent.deleteMany({ where: alvo.webhookWhere }),
    db.conversation.deleteMany({ where: { id: conv } }),
  ]
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
export async function purgeExpired(opts: {
  now?: Date
  dryRun?: boolean
}): Promise<ApagadoRelatorio[]> {
  const now = opts.now ?? new Date()
  const dryRun = opts.dryRun ?? false
  const tenants = await db.tenant.findMany({
    select: { id: true, slug: true, retentionDays: true },
  })
  const out: ApagadoRelatorio[] = []
  for (const tenant of tenants) {
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
      traceWhere: { tenantId: tenant.id, conversationId: { in: conversationIds } },
    }
    const contagens = await contar(alvo)
    if (!dryRun) await db.$transaction([...operacoesDeApagar(alvo)])
    out.push(
      relatorio(
        { operacao: 'retencao', dryRun, tenant: tenant.slug, prazoDias },
        alvo,
        contagens,
        now,
      ),
    )
  }
  return out
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
    traceWhere: { tenantId: tenant.id, conversationId: { in: conversationIds } },
  }
  const contagens = await contar(alvo)
  if (!dryRun) await db.$transaction([...operacoesDeApagar(alvo)])
  return relatorio(
    {
      operacao: 'apagar-contato',
      dryRun,
      tenant: tenant.slug,
      contatoHash: hashContato(opts.contactId),
    },
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
    traceWhere: { tenantId: tenant.id },
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
