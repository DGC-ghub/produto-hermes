import { describe, expect, it } from 'vitest'
import { freeSlots } from './slots'

const horario = { open: '08:00', close: '12:00', lunch: { from: '10:00', to: '10:30' } }

describe('freeSlots', () => {
  it('lista os horários do dia em passos da duração, sem passar do fechamento', () => {
    const r = freeSlots({ day: '2026-11-18', hours: horario, durationMin: 60, busy: [] })
    // 08:00, 09:00 e 11:00 (10:00 cai no intervalo; 11:00 vai até 12:00)
    expect(r).toEqual([
      '2026-11-18T08:00:00-03:00',
      '2026-11-18T09:00:00-03:00',
      '2026-11-18T11:00:00-03:00',
    ])
  })

  it('tira horários que batem com compromisso existente', () => {
    const r = freeSlots({
      day: '2026-11-18',
      hours: { open: '08:00', close: '11:00' },
      durationMin: 30,
      busy: [{ start: '2026-11-18T08:30:00-03:00', end: '2026-11-18T09:30:00-03:00' }],
    })
    expect(r).toEqual([
      '2026-11-18T08:00:00-03:00',
      '2026-11-18T09:30:00-03:00',
      '2026-11-18T10:00:00-03:00',
      '2026-11-18T10:30:00-03:00',
    ])
  })

  it('não oferece horário que já passou', () => {
    const r = freeSlots({
      day: '2026-11-18',
      hours: { open: '08:00', close: '10:00' },
      durationMin: 60,
      busy: [],
      now: '2026-11-18T08:30:00-03:00',
    })
    expect(r).toEqual(['2026-11-18T09:00:00-03:00'])
  })

  it('não oferece domingo', () => {
    // 2026-11-22 é domingo
    expect(freeSlots({ day: '2026-11-22', hours: horario, durationMin: 60, busy: [] })).toEqual([])
  })

  it('rejeita dia mal formado', () => {
    expect(() =>
      freeSlots({ day: '18/11/2026', hours: horario, durationMin: 60, busy: [] }),
    ).toThrow()
  })

  it('sábado usa o horário próprio, se houver', () => {
    const r = freeSlots({
      day: '2026-11-21',
      hours: { open: '08:00', close: '18:00' },
      saturday: { open: '08:00', close: '10:00' },
      durationMin: 60,
      busy: [],
    })
    expect(r).toEqual(['2026-11-21T08:00:00-03:00', '2026-11-21T09:00:00-03:00'])
  })
})
