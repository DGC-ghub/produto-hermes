import { brasiliaDay } from './slots'
import type { AgendaProvider, Appointment } from './types'

// A IA só PROPÕE. Quem valida e executa é o balcão (aqui), com o AgendaProvider.
export type PedidoAgenda = {
  operation: 'agendar' | 'remarcar' | 'cancelar'
  service?: string
  start?: string
}

export type ResultadoPedido = { ok: boolean; reply: string }

const OPERATIONS = new Set(['agendar', 'remarcar', 'cancelar'])
const ISO_BRASILIA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-03:00$/

/** Saneia o que a IA mandou. Qualquer coisa fora do formato vira null (descartada). */
export function parsePedido(raw: unknown): PedidoAgenda | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r.type !== 'pedir_agendamento') return null
  if (typeof r.operation !== 'string' || !OPERATIONS.has(r.operation)) return null
  const operation = r.operation as PedidoAgenda['operation']
  const service = typeof r.service === 'string' ? r.service.trim().slice(0, 80) : ''
  const start = typeof r.start === 'string' ? r.start.trim() : ''
  if (start && (!ISO_BRASILIA.test(start) || Number.isNaN(Date.parse(start)))) return null

  if (operation === 'cancelar') return { operation }
  if (!start) return null
  if (operation === 'remarcar') return { operation, start }
  if (!service) return null
  return { operation, service, start }
}

const pad = (n: number) => String(n).padStart(2, '0')
export function formatarHorario(iso: string): string {
  const d = new Date(Date.parse(iso) - 3 * 3600_000)
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} às ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** Consulta ativa (agendada ou confirmada) do paciente: a mais próxima. */
export async function consultaAtiva(
  agenda: AgendaProvider,
  patientRef: string,
): Promise<Appointment | null> {
  const mine = (await agenda.list())
    .filter((a) => a.patientRef === patientRef && a.status !== 'cancelado')
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  return mine[0] ?? null
}

const naoLivre = 'Esse horário não está mais livre. Posso te passar outros horários disponíveis?'
const semConsulta = 'Não encontrei uma consulta marcada para você. Quer agendar um horário?'

/**
 * Executa o pedido e devolve a resposta HONESTA: o texto sai do resultado real da agenda,
 * nunca da promessa da IA. Falha da agenda vira recusa clara, sem marcar nada.
 */
export async function executarPedido(
  agenda: AgendaProvider,
  patientRef: string,
  pedido: PedidoAgenda,
): Promise<ResultadoPedido> {
  const atual = await consultaAtiva(agenda, patientRef)
  try {
    if (pedido.operation === 'agendar') {
      if (atual) {
        return {
          ok: false,
          reply: `Você já tem uma consulta em ${formatarHorario(atual.start)}. Quer remarcar ou cancelar?`,
        }
      }
      const a = await agenda.book({
        patientRef,
        service: pedido.service as string,
        start: pedido.start as string,
      })
      return {
        ok: true,
        reply: `Pronto! Sua consulta (${a.service}) está marcada para ${formatarHorario(a.start)}.`,
      }
    }
    if (!atual) return { ok: false, reply: semConsulta }
    if (pedido.operation === 'remarcar') {
      const a = await agenda.reschedule(atual.id, pedido.start as string, patientRef)
      return {
        ok: true,
        reply: `Pronto! Sua consulta foi remarcada para ${formatarHorario(a.start)}.`,
      }
    }
    await agenda.cancel(atual.id, patientRef)
    return {
      ok: true,
      reply: 'Pronto! Sua consulta foi cancelada. Quando quiser marcar outra, é só chamar.',
    }
  } catch {
    return { ok: false, reply: naoLivre }
  }
}

/** Horários livres dos próximos dias úteis, para a IA oferecer só o que existe. */
export async function horariosParaOferecer(
  agenda: AgendaProvider,
  now: string,
  { dias = 5, max = 9 }: { dias?: number; max?: number } = {},
): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < dias + 2 && out.length < max; i++) {
    const day = brasiliaDay(new Date(Date.parse(now) + i * 24 * 3600_000).toISOString())
    out.push(...(await agenda.freeSlots(day)))
  }
  return out.slice(0, max)
}
