import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db.server'
import { generateAttendantReply } from '../attendant'
import { processIncomingMessage } from '../conversation.server'
import { createMemoryAgenda } from './memoria'
import { definirAgenda, enviarConfirmacoes, limparAgendas } from './registro'

// Cérebro mockado: a IA SÓ PROPÕE. Aqui provamos que o balcão valida e que o texto
// ao paciente vem do resultado real da agenda.
vi.mock('../attendant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../attendant')>()),
  generateAttendantReply: vi.fn(),
}))

const SLUG = 'clinica-demo'
const NOW = '2026-11-16T09:00:00-03:00' // segunda
const SLOT = '2026-11-18T08:00:00-03:00'
const P1 = 'test-agenda-p1'
const P2 = 'test-agenda-p2'

const propor = (start: string) =>
  vi.mocked(generateAttendantReply).mockResolvedValue({
    reply: 'Marquei sua limpeza!',
    needsHuman: false,
    handoffReason: null,
    confidence: 0.8,
    leadPatch: null,
    action: { type: 'pedir_agendamento', operation: 'agendar', service: 'Limpeza', start },
  })

const falar = (contactId: string, message: string) =>
  processIncomingMessage({ tenantSlug: SLUG, message, contactId, mode: 'whatsapp' })

let agenda: ReturnType<typeof createMemoryAgenda>

beforeEach(async () => {
  limparAgendas()
  agenda = createMemoryAgenda({
    hours: { open: '08:00', close: '12:00' },
    durationMin: 60,
    now: () => NOW,
  })
  definirAgenda(SLUG, agenda)
  await db.tenant.upsert({
    where: { slug: SLUG },
    update: {},
    create: { slug: SLUG, name: 'Clínica Aurora (demo)' },
  })
})

afterEach(async () => {
  vi.clearAllMocks()
  const convs = await db.conversation.findMany({
    where: { contactId: { in: [P1, P2] } },
    select: { id: true },
  })
  const ids = convs.map((c) => c.id)
  await db.handoffEvent.deleteMany({ where: { conversationId: { in: ids } } })
  await db.lead.deleteMany({ where: { conversationId: { in: ids } } })
  await db.message.deleteMany({ where: { conversationId: { in: ids } } })
  await db.conversation.deleteMany({ where: { id: { in: ids } } })
})

describe('agenda ligada ao motor (WhatsApp)', () => {
  it('a IA propõe, o balcão marca e responde com o resultado real', async () => {
    propor(SLOT)
    const r = await falar(P1, 'quero a limpeza dia 18 às 8h, pode marcar')
    expect(r.reply).toMatch(/marcada para 18\/11 às 08:00/)
    expect(r.reply).not.toMatch(/Marquei/)
    const lista = await agenda.list()
    expect(lista).toHaveLength(1)
    expect(lista[0].patientRef).toBe(P1)
  })

  it('o cérebro recebe só horários livres da agenda', async () => {
    vi.mocked(generateAttendantReply).mockResolvedValue({
      reply: 'Qual horário?',
      needsHuman: false,
      handoffReason: null,
      confidence: 0.8,
      leadPatch: null,
      action: null,
    })
    await falar(P1, 'quero marcar uma limpeza')
    const input = vi.mocked(generateAttendantReply).mock.calls[0][0]
    expect(input.enabledTools).toContain('pedir_agendamento')
    expect(input.agenda).toBeDefined()
  })

  it('horário ocupado: não há dupla marcação e o paciente é avisado', async () => {
    propor(SLOT)
    await falar(P1, 'marca dia 18 às 8h')
    const r = await falar(P2, 'marca dia 18 às 8h também')
    expect(r.reply).toMatch(/não está mais livre/)
    expect(await agenda.list()).toHaveLength(1)
  })

  it('resposta 1 confirma sem chamar o cérebro', async () => {
    propor(SLOT)
    await falar(P1, 'marca dia 18 às 8h')
    vi.mocked(generateAttendantReply).mockClear()
    const dia17 = '2026-11-17T08:00:00-03:00'
    const a = await agenda.book({ patientRef: P2, service: 'Limpeza', start: dia17 })
    const lote = await enviarConfirmacoes(SLUG, 'Clínica Aurora (demo)', NOW)
    expect(lote.map((m) => m.patientRef)).toEqual([P2])
    const r = await falar(P2, '1')
    expect(generateAttendantReply).not.toHaveBeenCalled()
    expect(r.reply).toMatch(/confirmada/i)
    expect((await agenda.list()).find((x) => x.id === a.id)?.status).toBe('confirmado')
  })

  it('resposta fora do 1/2/3 vai para a recepção', async () => {
    await agenda.book({ patientRef: P2, service: 'Limpeza', start: '2026-11-17T08:00:00-03:00' })
    await enviarConfirmacoes(SLUG, 'Clínica Aurora (demo)', NOW)
    const r = await falar(P2, 'sim, mas posso chegar mais tarde?')
    expect(r.needsHuman).toBe(true)
    expect(generateAttendantReply).not.toHaveBeenCalled()
    const conv = await db.conversation.findFirst({ where: { contactId: P2 } })
    expect(conv?.status).toBe('needs_human')
  })

  it('demo pública não mexe na agenda', async () => {
    propor(SLOT)
    await processIncomingMessage({
      tenantSlug: SLUG,
      message: 'marca',
      contactId: P1,
      mode: 'public_demo',
    })
    expect(await agenda.list()).toHaveLength(0)
  })
})
