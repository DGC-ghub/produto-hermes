// E2E da demo de clínica (tenant fictício "clinica-demo"): do primeiro contato ao
// agendamento, confirmação e transbordo. Provider de IA SIMULADO (nada pago, nada de
// WhatsApp real); balcão, agenda, handoff e banco são os reais. Dados 100% fictícios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db.server'
import { generateAttendantReply } from '../attendant'
import { processIncomingMessage } from '../conversation.server'
import { createMemoryAgenda } from './memoria'
import { definirAgenda, enviarConfirmacoes, limparAgendas } from './registro'

vi.mock('../attendant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../attendant')>()),
  generateAttendantReply: vi.fn(),
}))

const SLUG = 'clinica-demo'
const OUTRO = 'dgc'
const NOW = '2026-11-16T09:00:00-03:00'
const SLOT = '2026-11-18T08:00:00-03:00'
const MARIA = 'e2e-clinica-maria'
const JOAO = 'e2e-clinica-joao'

const cerebro = (over: Record<string, unknown> = {}) =>
  vi.mocked(generateAttendantReply).mockResolvedValue({
    reply: 'Posso ajudar!',
    needsHuman: false,
    handoffReason: null,
    confidence: 0.8,
    leadPatch: null,
    action: null,
    ...over,
  } as never)

const pedirLimpeza = (start: string) =>
  cerebro({
    reply: 'Marquei!',
    action: { type: 'pedir_agendamento', operation: 'agendar', service: 'Limpeza', start },
  })

const falar = (contactId: string, message: string, tenantSlug = SLUG) =>
  processIncomingMessage({ tenantSlug, message, contactId, mode: 'whatsapp' })

const novaAgenda = () =>
  createMemoryAgenda({ hours: { open: '08:00', close: '12:00' }, durationMin: 60, now: () => NOW })

let agenda: ReturnType<typeof novaAgenda>

beforeEach(async () => {
  limparAgendas()
  agenda = novaAgenda()
  definirAgenda(SLUG, agenda)
  for (const slug of [SLUG, OUTRO])
    await db.tenant.upsert({ where: { slug }, update: {}, create: { slug, name: slug } })
})

afterEach(async () => {
  vi.clearAllMocks()
  const convs = await db.conversation.findMany({
    where: { contactId: { in: [MARIA, JOAO] } },
    select: { id: true },
  })
  const ids = convs.map((c) => c.id)
  await db.handoffEvent.deleteMany({ where: { conversationId: { in: ids } } })
  await db.lead.deleteMany({ where: { conversationId: { in: ids } } })
  await db.message.deleteMany({ where: { conversationId: { in: ids } } })
  await db.conversation.deleteMany({ where: { id: { in: ids } } })
})

describe('demo de clínica — jornada completa do paciente', () => {
  it('contato → dúvida → agendamento → confirmação 1, tudo na mesma conversa', async () => {
    cerebro({ reply: 'Olá! Sou a assistente virtual da clínica.' })
    const r1 = await falar(MARIA, 'oi, qual o horário de sábado?')
    expect(r1.needsHuman).toBe(false)

    pedirLimpeza(SLOT)
    const r2 = await falar(MARIA, 'quero a limpeza dia 18 às 8h')
    expect(r2.reply).toMatch(/marcada para 18\/11 às 08:00/)

    const lista = await agenda.list()
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ patientRef: MARIA, service: 'Limpeza' })

    const lote = await enviarConfirmacoes(
      SLUG,
      'Clínica Aurora (demo)',
      '2026-11-17T09:00:00-03:00',
    )
    expect(lote.map((m) => m.patientRef)).toEqual([MARIA])

    vi.mocked(generateAttendantReply).mockClear()
    const r3 = await falar(MARIA, '1')
    expect(generateAttendantReply).not.toHaveBeenCalled()
    expect(r3.reply).toMatch(/confirmada/i)
    expect((await agenda.list())[0].status).toBe('confirmado')

    const convs = await db.conversation.findMany({ where: { contactId: MARIA } })
    expect(convs).toHaveLength(1)
    const msgs = await db.message.count({ where: { conversationId: convs[0].id } })
    expect(msgs).toBeGreaterThanOrEqual(6) // 3 do paciente + 3 respostas
  })

  it('tema de saúde vai para a recepção SEM chamar a IA e sem agendar', async () => {
    pedirLimpeza(SLOT)
    const r = await falar(MARIA, 'estou com dor de dente, quero marcar hoje')
    expect(r.needsHuman).toBe(true)
    expect(generateAttendantReply).not.toHaveBeenCalled()
    expect(await agenda.list()).toHaveLength(0)
    const conv = await db.conversation.findFirst({ where: { contactId: MARIA } })
    expect(conv?.status).toBe('needs_human')
  })

  it('quando a recepção assume a conversa, a IA se cala e nada é agendado', async () => {
    cerebro()
    await falar(MARIA, 'quero falar com um atendente')
    const conv = await db.conversation.findFirstOrThrow({ where: { contactId: MARIA } })
    expect(conv.status).toBe('needs_human')
    await db.conversation.update({ where: { id: conv.id }, data: { status: 'human' } }) // recepção assumiu
    vi.mocked(generateAttendantReply).mockClear()
    pedirLimpeza(SLOT)
    await falar(MARIA, 'marca dia 18 às 8h')
    expect(generateAttendantReply).not.toHaveBeenCalled()
    expect(await agenda.list()).toHaveLength(0)
  })

  it('horário fora do expediente não é marcado', async () => {
    pedirLimpeza('2026-11-18T20:00:00-03:00')
    const r = await falar(MARIA, 'marca às 20h')
    expect(await agenda.list()).toHaveLength(0)
    expect(r.reply).not.toMatch(/marcada para/)
  })
})

describe('demo de clínica — isolamento entre contatos e empresas', () => {
  it('um paciente não enxerga nem confirma a consulta do outro', async () => {
    await agenda.book({ patientRef: MARIA, service: 'Limpeza', start: '2026-11-17T08:00:00-03:00' })
    await enviarConfirmacoes(SLUG, 'Clínica Aurora (demo)', NOW)
    cerebro()
    const r = await falar(JOAO, '1') // João não tem confirmação pendente
    const a = (await agenda.list()).find((x) => x.patientRef === MARIA)
    expect(a?.status).not.toBe('confirmado')
    expect(r.reply).not.toMatch(/Maria/i)
  })

  it('o mesmo contato em duas empresas tem conversas separadas', async () => {
    cerebro()
    await falar(MARIA, 'oi')
    await falar(MARIA, 'oi', OUTRO)
    const convs = await db.conversation.findMany({ where: { contactId: MARIA } })
    expect(convs).toHaveLength(2)
    expect(new Set(convs.map((c) => c.tenantId)).size).toBe(2)
  })

  it('agendamento na clínica não aparece na agenda de outra empresa', async () => {
    const outraAgenda = novaAgenda()
    definirAgenda(OUTRO, outraAgenda)
    pedirLimpeza(SLOT)
    await falar(MARIA, 'marca dia 18 às 8h')
    expect(await agenda.list()).toHaveLength(1)
    expect(await outraAgenda.list()).toHaveLength(0)
  })

  it('demo pública nunca grava na agenda', async () => {
    pedirLimpeza(SLOT)
    await processIncomingMessage({
      tenantSlug: SLUG,
      message: 'marca',
      contactId: MARIA,
      mode: 'public_demo',
    })
    expect(await agenda.list()).toHaveLength(0)
  })
})
