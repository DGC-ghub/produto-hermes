import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import { createMemoryAgenda } from './agenda/memoria'
import { definirAgenda, limparAgendas } from './agenda/registro'
import { generateAttendantReply } from './attendant'
import { loadTenantConfig } from './attendant/tenant-config'
import { resolveTenantConfig } from './attendant/tenant-config-db.server'
import { processIncomingMessage } from './conversation.server'
import { OPT_IN_QUESTION, podeReceber } from './optin'
import { lerOptIn } from './optin.server'

vi.mock('./attendant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./attendant')>()),
  generateAttendantReply: vi.fn(),
}))
vi.mock('./attendant/tenant-config-db.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./attendant/tenant-config-db.server')>()),
  resolveTenantConfig: vi.fn(),
}))

const SLUG = 'clinica-demo'
const NOW = '2026-11-16T09:00:00-03:00'
const SLOT = '2026-11-18T08:00:00-03:00'
const P = 'test-optin-p1'

const configCom = (optIn: boolean) => {
  const base = loadTenantConfig(SLUG)
  return { ...base, optIn: optIn ? { enabled: true } : undefined }
}
const cerebro = (reply: string, start?: string) =>
  vi.mocked(generateAttendantReply).mockResolvedValue({
    reply,
    needsHuman: false,
    handoffReason: null,
    confidence: 0.8,
    leadPatch: null,
    action: start
      ? { type: 'pedir_agendamento', operation: 'agendar', service: 'Limpeza', start }
      : null,
  })
const falar = (message: string) =>
  processIncomingMessage({ tenantSlug: SLUG, message, contactId: P, mode: 'whatsapp' })

let tenantId = ''
beforeEach(async () => {
  limparAgendas()
  definirAgenda(
    SLUG,
    createMemoryAgenda({
      hours: { open: '08:00', close: '12:00' },
      durationMin: 60,
      now: () => NOW,
    }),
  )
  const t = await db.tenant.upsert({
    where: { slug: SLUG },
    update: {},
    create: { slug: SLUG, name: 'Clínica Aurora (demo)' },
  })
  tenantId = t.id
  vi.mocked(resolveTenantConfig).mockResolvedValue(configCom(true))
})

afterEach(async () => {
  vi.clearAllMocks()
  const convs = await db.conversation.findMany({ where: { contactId: P }, select: { id: true } })
  const ids = convs.map((c) => c.id)
  await db.handoffEvent.deleteMany({ where: { conversationId: { in: ids } } })
  await db.lead.deleteMany({ where: { conversationId: { in: ids } } })
  await db.message.deleteMany({ where: { conversationId: { in: ids } } })
  await db.conversation.deleteMany({ where: { id: { in: ids } } })
  await db.contactOptIn.deleteMany({ where: { contactId: P } })
})

describe('opt-in na conversa', () => {
  it('não pergunta antes de resolver o pedido', async () => {
    cerebro('Qual horário prefere?')
    const r = await falar('quero marcar uma limpeza')
    expect(r.reply).not.toContain(OPT_IN_QUESTION)
    expect(await lerOptIn(tenantId, P)).toBeNull()
  })

  it('pergunta uma vez depois da consulta marcada; sem resposta fica pendente', async () => {
    cerebro('Marquei!', SLOT)
    const r = await falar('marca dia 18 às 8h')
    expect(r.reply).toMatch(/marcada para 18\/11/)
    expect(r.reply).toContain(OPT_IN_QUESTION)
    const reg = await lerOptIn(tenantId, P)
    expect(reg?.askedAt).toBeInstanceOf(Date)
    expect(reg?.status).toBeNull() // sem resposta
    expect(podeReceber(reg, 'reativacao')).toBe(false)
    expect(podeReceber(reg, 'lembrete_consulta')).toBe(true)

    // Segue a conversa sem responder: não pergunta de novo.
    cerebro('A clínica abre às 8h.')
    const r2 = await falar('obrigada, que horas abre sábado?')
    expect(r2.reply).not.toContain(OPT_IN_QUESTION)
  })

  it('"sim" grava com data e mensagem de origem, sem chamar o cérebro nem confirmar consulta', async () => {
    cerebro('Marquei!', SLOT)
    await falar('marca dia 18 às 8h')
    vi.mocked(generateAttendantReply).mockClear()
    const r = await falar('sim')
    expect(generateAttendantReply).not.toHaveBeenCalled()
    expect(r.reply).toMatch(/lembretes e novidades/)
    const reg = await lerOptIn(tenantId, P)
    expect(reg?.status).toBe('sim')
    expect(reg?.decidedAt).toBeInstanceOf(Date)
    const row = await db.contactOptIn.findFirst({ where: { contactId: P } })
    expect(row?.sourceMessageId).toBe(r.userMessageId)
    expect(podeReceber(reg, 'reativacao')).toBe(true)
  })

  it('"não" em linguagem natural grava nao e bloqueia reativação', async () => {
    cerebro('Marquei!', SLOT)
    await falar('marca dia 18 às 8h')
    await falar('prefiro não, obrigada')
    const reg = await lerOptIn(tenantId, P)
    expect(reg?.status).toBe('nao')
    expect(podeReceber(reg, 'reativacao')).toBe(false)
    expect(podeReceber(reg, 'followup_marketing')).toBe(false)
  })

  it('"parar" depois de sim grava nao', async () => {
    cerebro('Marquei!', SLOT)
    await falar('marca dia 18 às 8h')
    await falar('quero')
    expect((await lerOptIn(tenantId, P))?.status).toBe('sim')
    const r = await falar('PARAR')
    expect(r.reply).toMatch(/não vou mais/)
    expect((await lerOptIn(tenantId, P))?.status).toBe('nao')
  })

  it('com a flag desligada nada muda: não pergunta nem grava', async () => {
    vi.mocked(resolveTenantConfig).mockResolvedValue(configCom(false))
    cerebro('Marquei!', SLOT)
    const r = await falar('marca dia 18 às 8h')
    expect(r.reply).not.toContain(OPT_IN_QUESTION)
    expect(await db.contactOptIn.count({ where: { contactId: P } })).toBe(0)
  })
})
