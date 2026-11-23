import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import { generateAttendantReply } from './attendant'
import { loadTenantConfig } from './attendant/tenant-config'
import { resolveTenantConfig } from './attendant/tenant-config-db.server'
import { processIncomingMessage } from './conversation.server'

vi.mock('./attendant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./attendant')>()),
  generateAttendantReply: vi.fn(),
}))
vi.mock('./attendant/tenant-config-db.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./attendant/tenant-config-db.server')>()),
  resolveTenantConfig: vi.fn(),
}))

const SLUG = 'clinica-sem-agenda-demo'
const P = 'test-aviso-p1'
const falar = (message: string) =>
  processIncomingMessage({ tenantSlug: SLUG, message, contactId: P, mode: 'whatsapp' })

beforeEach(async () => {
  await db.tenant.upsert({
    where: { slug: SLUG },
    update: {},
    create: { slug: SLUG, name: 'Clínica Boa Vista (demo sem agenda)' },
  })
  vi.mocked(resolveTenantConfig).mockResolvedValue(loadTenantConfig(SLUG))
  vi.mocked(generateAttendantReply).mockResolvedValue({
    reply: 'Qual dia e horário você prefere?',
    needsHuman: false,
    handoffReason: null,
    confidence: 0.8,
    leadPatch: null,
    action: null,
  })
})

afterEach(async () => {
  vi.clearAllMocks()
  const convs = await db.conversation.findMany({ where: { contactId: P }, select: { id: true } })
  const ids = convs.map((c) => c.id)
  await db.handoffEvent.deleteMany({ where: { conversationId: { in: ids } } })
  await db.lead.deleteMany({ where: { conversationId: { in: ids } } })
  await db.message.deleteMany({ where: { conversationId: { in: ids } } })
  await db.conversation.deleteMany({ where: { id: { in: ids } } })
})

describe('aviso fixo de assistente virtual (DGC-442)', () => {
  it('vai na 1ª resposta e não se repete na 2ª', async () => {
    const r1 = await falar('oi, queria marcar uma consulta')
    expect(r1.reply).toMatch(/^Olá! Sou a assistente virtual da Clínica Boa Vista/)
    expect(r1.reply).toContain('Qual dia e horário você prefere?')
    const r2 = await falar('quinta de manhã')
    expect(r2.reply).toBe('Qual dia e horário você prefere?')
  })

  it('vai também quando o balcão responde sozinho (tema sensível na 1ª mensagem)', async () => {
    const r = await falar('estou com dor de dente')
    expect(r.needsHuman).toBe(true)
    expect(r.reply).toContain('assistente virtual')
    expect(generateAttendantReply).not.toHaveBeenCalled()
  })
})
