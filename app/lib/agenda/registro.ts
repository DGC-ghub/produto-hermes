import { appointmentsToConfirm, confirmationMessage, parseConfirmationReply } from './confirmacao'
import { createMemoryAgenda } from './memoria'
import type { AgendaProvider } from './types'

// Uma agenda por tenant. Só a demo tem agenda em memória (dados fictícios). Tenant sem
// agenda não agenda: a ação da IA é descartada. O piloto troca por Google Agenda aqui.
const agendas = new Map<string, AgendaProvider>()
// Consultas que já receberam o pedido de confirmação e esperam 1/2/3. Chave: tenant + paciente.
const pendentes = new Map<string, string>()
const chave = (tenant: string, patientRef: string) => `${tenant}\u0000${patientRef}`

const DEMO_SLUG = 'clinica-demo'

export function agendaDoTenant(slug: string): AgendaProvider | null {
  const existente = agendas.get(slug)
  if (existente) return existente
  if (slug !== DEMO_SLUG) return null
  const nova = createMemoryAgenda({
    hours: { open: '08:00', close: '18:00', lunch: { from: '12:00', to: '13:30' } },
    saturday: { open: '08:00', close: '12:00' },
    durationMin: 60,
    now: () => new Date().toISOString(),
  })
  agendas.set(slug, nova)
  return nova
}

export function definirAgenda(slug: string, agenda: AgendaProvider): void {
  agendas.set(slug, agenda)
}

export function limparAgendas(): void {
  agendas.clear()
  pendentes.clear()
}

export type MensagemDeConfirmacao = { patientRef: string; appointmentId: string; text: string }

/** Botão "enviar confirmações de amanhã": 1 mensagem por consulta, só para quem agendou. */
export async function enviarConfirmacoes(
  tenant: string,
  clinicName: string,
  now: string,
): Promise<MensagemDeConfirmacao[]> {
  const agenda = agendaDoTenant(tenant)
  if (!agenda) return []
  const alvo = appointmentsToConfirm(await agenda.list(), now).filter(
    (a) => pendentes.get(chave(tenant, a.patientRef)) !== a.id,
  )
  return alvo.map((a) => {
    pendentes.set(chave(tenant, a.patientRef), a.id)
    return {
      patientRef: a.patientRef,
      appointmentId: a.id,
      text: confirmationMessage(a, clinicName),
    }
  })
}

/** Envio falhou: tira a pendência para a consulta poder receber a confirmação de novo. */
export function desfazerPendencia(tenant: string, patientRef: string): void {
  pendentes.delete(chave(tenant, patientRef))
}

export type RespostaConfirmacao = { kind: 'resposta'; reply: string } | { kind: 'humano' }

/**
 * Resposta do paciente a uma confirmação pendente. null = não há pendência, segue o fluxo normal.
 * 1 confirma, 3 cancela; 2 libera a IA para oferecer novos horários; o resto vai para a recepção.
 */
export async function tratarRespostaConfirmacao(
  tenant: string,
  patientRef: string,
  text: string,
): Promise<RespostaConfirmacao | null> {
  const agenda = agendaDoTenant(tenant)
  const id = pendentes.get(chave(tenant, patientRef))
  if (!agenda || !id) return null
  const reply = parseConfirmationReply(text)
  if (reply === 'humano') return { kind: 'humano' }
  pendentes.delete(chave(tenant, patientRef))
  try {
    if (reply === 'confirmar') {
      await agenda.confirm(id, patientRef)
      return { kind: 'resposta', reply: 'Consulta confirmada! Esperamos você. Até lá!' }
    }
    if (reply === 'cancelar') {
      await agenda.cancel(id, patientRef)
      return {
        kind: 'resposta',
        reply: 'Sua consulta foi cancelada. Quando quiser marcar outra, é só chamar.',
      }
    }
    return {
      kind: 'resposta',
      reply:
        'Sem problema! Qual dia e período ficam melhores para você? Eu te passo os horários livres.',
    }
  } catch {
    return { kind: 'humano' }
  }
}
