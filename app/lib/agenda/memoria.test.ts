import { describe, expect, it } from 'vitest'
import { createMemoryAgenda } from './memoria'

const hours = { open: '08:00', close: '12:00' }

describe('agenda em memória (demo)', () => {
  it('marca, ocupa o horário e impede marcar duas vezes o mesmo', async () => {
    const ag = createMemoryAgenda({ hours, durationMin: 60 })
    const a = await ag.book({
      patientRef: 'p1',
      service: 'Limpeza',
      start: '2026-11-18T08:00:00-03:00',
    })
    expect(a.status).toBe('agendado')
    expect(await ag.freeSlots('2026-11-18')).not.toContain('2026-11-18T08:00:00-03:00')
    await expect(
      ag.book({ patientRef: 'p2', service: 'Limpeza', start: '2026-11-18T08:00:00-03:00' }),
    ).rejects.toThrow(/ocupado/)
  })

  it('não marca fora de um horário livre', async () => {
    const ag = createMemoryAgenda({ hours, durationMin: 60 })
    await expect(
      ag.book({ patientRef: 'p1', service: 'Limpeza', start: '2026-11-18T23:00:00-03:00' }),
    ).rejects.toThrow(/ocupado|fora/)
  })

  it('cancelar libera o horário; remarcar move sem duplicar', async () => {
    const ag = createMemoryAgenda({ hours, durationMin: 60 })
    const a = await ag.book({
      patientRef: 'p1',
      service: 'Limpeza',
      start: '2026-11-18T08:00:00-03:00',
    })
    const b = await ag.reschedule(a.id, '2026-11-18T09:00:00-03:00')
    expect(b.start).toBe('2026-11-18T09:00:00-03:00')
    expect(await ag.freeSlots('2026-11-18')).toContain('2026-11-18T08:00:00-03:00')
    await ag.cancel(b.id)
    expect(await ag.freeSlots('2026-11-18')).toContain('2026-11-18T09:00:00-03:00')
    expect((await ag.list()).find((x) => x.id === b.id)?.status).toBe('cancelado')
  })

  it('só o dono (patientRef) mexe no próprio agendamento', async () => {
    const ag = createMemoryAgenda({ hours, durationMin: 60 })
    const a = await ag.book({
      patientRef: 'p1',
      service: 'Limpeza',
      start: '2026-11-18T08:00:00-03:00',
    })
    await expect(ag.cancel(a.id, 'p2')).rejects.toThrow(/não encontrado/)
    await ag.cancel(a.id, 'p1')
  })

  it('confirmar muda o status', async () => {
    const ag = createMemoryAgenda({ hours, durationMin: 60 })
    const a = await ag.book({
      patientRef: 'p1',
      service: 'Limpeza',
      start: '2026-11-18T08:00:00-03:00',
    })
    expect((await ag.confirm(a.id, 'p1')).status).toBe('confirmado')
  })
})
