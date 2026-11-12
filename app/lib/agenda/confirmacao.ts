import { brasiliaDay } from './slots'
import type { Appointment } from './types'

export type ConfirmationReply = 'confirmar' | 'remarcar' | 'cancelar' | 'humano'

/** Agendados do dia seguinte (dia de Brasília) que ainda não confirmaram. */
export function appointmentsToConfirm(list: Appointment[], now: string): Appointment[] {
  const amanha = brasiliaDay(new Date(Date.parse(now) + 24 * 3600_000).toISOString())
  return list.filter((a) => a.status === 'agendado' && brasiliaDay(a.start) === amanha)
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

// Só resposta curta e inequívoca vira ação. Qualquer outra coisa (dor, dúvida, "sim, mas...")
// vai para a recepção: confirmar por chute esconde um paciente com problema.
const CONFIRMAR = new Set(['1', 'sim', 'confirmo', 'confirmado', 'confirmar', 'ok', 'estarei la'])
const REMARCAR = new Set([
  '2',
  'remarcar',
  'preciso remarcar',
  'quero remarcar',
  'nao vou poder',
  'nao posso',
])
const CANCELAR = new Set(['3', 'cancelar', 'quero cancelar', 'cancela'])

export function parseConfirmationReply(text: string): ConfirmationReply {
  const t = norm(text)
    .replace(/[!.?,]+/g, '')
    .trim()
  if (CONFIRMAR.has(t)) return 'confirmar'
  if (REMARCAR.has(t)) return 'remarcar'
  if (CANCELAR.has(t)) return 'cancelar'
  return 'humano'
}

export function confirmationMessage(a: Appointment, clinicName: string): string {
  const d = new Date(Date.parse(a.start) - 3 * 3600_000)
  const dia = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  const hora = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  return [
    `Olá! Sou a assistente virtual da ${clinicName}.`,
    `Sua consulta (${a.service}) está marcada para ${dia} às ${hora}.`,
    'Responda:',
    '1 - Confirmo',
    '2 - Preciso remarcar',
    '3 - Quero cancelar',
  ].join('\n')
}
