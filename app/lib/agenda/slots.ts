import type { DayHours } from './types'

const TZ = '-03:00' // Brasília, sem horário de verão desde 2019
const DAY = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

const toMin = (hhmm: string): number => {
  const m = HHMM.exec(hhmm)
  if (!m) throw new Error(`horário inválido: ${hhmm}`)
  return Number(m[1]) * 60 + Number(m[2])
}
const pad = (n: number) => String(n).padStart(2, '0')

export function brasiliaDay(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) throw new Error(`data inválida: ${iso}`)
  return new Date(t - 3 * 3600_000).toISOString().slice(0, 10)
}

export type FreeSlotsInput = {
  day: string // 'YYYY-MM-DD'
  hours: DayHours
  saturday?: DayHours // se ausente, sábado segue `hours`
  durationMin: number
  busy: { start: string; end: string }[]
  now?: string
}

/** Horários livres do dia, em passos da duração. Função pura. Domingo não abre. */
export function freeSlots({
  day,
  hours: weekHours,
  saturday,
  durationMin,
  busy,
  now,
}: FreeSlotsInput): string[] {
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00${TZ}`))) {
    throw new Error(`dia inválido: ${day}`)
  }
  if (!Number.isInteger(durationMin) || durationMin <= 0) throw new Error('duração inválida')
  const dow = new Date(`${day}T12:00:00${TZ}`).getUTCDay()
  if (dow === 0) return []
  const hours = dow === 6 && saturday ? saturday : weekHours

  const open = toMin(hours.open)
  const close = toMin(hours.close)
  const lunch = hours.lunch ? { from: toMin(hours.lunch.from), to: toMin(hours.lunch.to) } : null
  const nowMs = now ? Date.parse(now) : null
  const busyMs = busy.map((b) => ({ s: Date.parse(b.start), e: Date.parse(b.end) }))

  const out: string[] = []
  for (let m = open; m + durationMin <= close; m += durationMin) {
    if (lunch && m < lunch.to && m + durationMin > lunch.from) continue
    const iso = `${day}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00${TZ}`
    const s = Date.parse(iso)
    const e = s + durationMin * 60_000
    if (nowMs !== null && s < nowMs) continue
    if (busyMs.some((b) => s < b.e && e > b.s)) continue
    out.push(iso)
  }
  return out
}
