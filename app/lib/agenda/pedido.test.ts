import { describe, expect, it } from 'vitest'
import { createMemoryAgenda } from './memoria'
import { executarPedido, parsePedido } from './pedido'

const hours = { open: '08:00', close: '12:00' }
const NOW = '2026-11-16T09:00:00-03:00' // segunda
const mk = () => createMemoryAgenda({ hours, durationMin: 60, now: () => NOW })
const S1 = '2026-11-18T08:00:00-03:00'
const S2 = '2026-11-18T09:00:00-03:00'

describe('parsePedido (formato do que a IA propõe)', () => {
  it('aceita agendar com serviço e horário ISO', () => {
    expect(
      parsePedido({
        type: 'pedir_agendamento',
        operation: 'agendar',
        service: 'Limpeza',
        start: S1,
      }),
    ).toEqual({
      operation: 'agendar',
      service: 'Limpeza',
      start: S1,
    })
  })
  it.each([
    null,
    { type: 'abrir_chamado' },
    { type: 'pedir_agendamento', operation: 'apagar_tudo' },
    { type: 'pedir_agendamento', operation: 'agendar', service: 'Limpeza' },
    { type: 'pedir_agendamento', operation: 'agendar', service: 'Limpeza', start: 'amanhã cedo' },
    { type: 'pedir_agendamento', operation: 'agendar', service: '  ', start: S1 },
  ])('descarta pedido malformado %#', (raw) => {
    expect(parsePedido(raw)).toBeNull()
  })
  it('cancelar não precisa de horário', () => {
    expect(parsePedido({ type: 'pedir_agendamento', operation: 'cancelar' })).toEqual({
      operation: 'cancelar',
    })
  })
})

describe('executarPedido (o balcão valida)', () => {
  it('agenda em horário livre e a resposta vem do balcão', async () => {
    const ag = mk()
    const r = await executarPedido(ag, 'p1', {
      operation: 'agendar',
      service: 'Limpeza',
      start: S1,
    })
    expect(r.ok).toBe(true)
    expect(r.reply).toMatch(/18\/11 às 08:00/)
    expect((await ag.list()).length).toBe(1)
  })
  it('recusa horário ocupado, sem dupla marcação, e diz a verdade', async () => {
    const ag = mk()
    await executarPedido(ag, 'p1', { operation: 'agendar', service: 'Limpeza', start: S1 })
    const r = await executarPedido(ag, 'p2', {
      operation: 'agendar',
      service: 'Limpeza',
      start: S1,
    })
    expect(r.ok).toBe(false)
    expect(r.reply).toMatch(/não está mais livre/)
    expect((await ag.list()).length).toBe(1)
  })
  it('paciente com consulta ativa não marca outra: remarca', async () => {
    const ag = mk()
    await executarPedido(ag, 'p1', { operation: 'agendar', service: 'Limpeza', start: S1 })
    const r = await executarPedido(ag, 'p1', {
      operation: 'agendar',
      service: 'Limpeza',
      start: S2,
    })
    expect(r.ok).toBe(false)
    expect((await ag.list()).length).toBe(1)
  })
  it('remarca a própria consulta e libera o horário antigo', async () => {
    const ag = mk()
    await executarPedido(ag, 'p1', { operation: 'agendar', service: 'Limpeza', start: S1 })
    const r = await executarPedido(ag, 'p1', { operation: 'remarcar', start: S2 })
    expect(r.ok).toBe(true)
    expect(await ag.freeSlots('2026-11-18')).toContain(S1)
  })
  it('cancela só a consulta do próprio paciente', async () => {
    const ag = mk()
    await executarPedido(ag, 'p1', { operation: 'agendar', service: 'Limpeza', start: S1 })
    const outro = await executarPedido(ag, 'p2', { operation: 'cancelar' })
    expect(outro.ok).toBe(false)
    const r = await executarPedido(ag, 'p1', { operation: 'cancelar' })
    expect(r.ok).toBe(true)
    expect(await ag.freeSlots('2026-11-18')).toContain(S1)
  })
})
