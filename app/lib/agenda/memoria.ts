import { randomUUID } from 'node:crypto'
import { brasiliaDay, freeSlots } from './slots'
import type { AgendaProvider, Appointment, DayHours } from './types'

export type MemoryAgendaOptions = {
  hours: DayHours
  saturday?: DayHours
  durationMin: number
  now?: () => string
}

/** Agenda da demo: só em memória, dados fictícios. */
export function createMemoryAgenda(opts: MemoryAgendaOptions): AgendaProvider {
  const items = new Map<string, Appointment>()
  const active = () => [...items.values()].filter((a) => a.status !== 'cancelado')
  const endOf = (start: string) =>
    new Date(Date.parse(start) + opts.durationMin * 60_000).toISOString()

  const slotsOf = (day: string, ignoreId?: string) =>
    freeSlots({
      day,
      hours: opts.hours,
      saturday: opts.saturday,
      durationMin: opts.durationMin,
      busy: active().filter((a) => a.id !== ignoreId),
      now: opts.now?.(),
    })

  const assertFree = (start: string, ignoreId?: string) => {
    const ok = slotsOf(brasiliaDay(start), ignoreId).some(
      (s) => Date.parse(s) === Date.parse(start),
    )
    if (!ok) throw new Error('horário ocupado ou fora do expediente')
  }
  const own = (id: string, patientRef?: string): Appointment => {
    const a = items.get(id)
    if (!a || (patientRef !== undefined && a.patientRef !== patientRef)) {
      throw new Error('agendamento não encontrado')
    }
    return a
  }

  return {
    name: 'memoria',
    async freeSlots(day) {
      return slotsOf(day)
    },
    async book({ patientRef, service, start }) {
      assertFree(start)
      const a: Appointment = {
        id: randomUUID(),
        patientRef,
        service,
        start,
        end: endOf(start),
        status: 'agendado',
      }
      items.set(a.id, a)
      return a
    },
    async reschedule(id, newStart, patientRef) {
      const a = own(id, patientRef)
      if (a.status === 'cancelado') throw new Error('agendamento não encontrado')
      assertFree(newStart, id)
      const b = { ...a, start: newStart, end: endOf(newStart), status: 'agendado' as const }
      items.set(id, b)
      return b
    },
    async cancel(id, patientRef) {
      const b = { ...own(id, patientRef), status: 'cancelado' as const }
      items.set(id, b)
      return b
    },
    async confirm(id, patientRef) {
      const a = own(id, patientRef)
      if (a.status === 'cancelado') throw new Error('agendamento não encontrado')
      const b = { ...a, status: 'confirmado' as const }
      items.set(id, b)
      return b
    },
    async list() {
      return [...items.values()]
    },
  }
}
