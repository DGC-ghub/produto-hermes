// Contrato do "Hermes Atendente" — o cérebro plugável do Produto Hermes.
// O balcão (processIncomingMessage) monta o AttendantInput, chama um provider e
// recebe um AttendantOutput já validado. Nenhuma parte do produto sabe qual
// provider está ativo (mock | claude_cli).
import type { ToolName } from './tenant-config'

export type AttendantHistoryTurn = {
  role: 'user' | 'assistant'
  content: string
}

export type AttendantLeadSnapshot = {
  name: string | null
  phone: string | null
  neighborhood: string | null
  need: string | null
  urgency: string | null
}

export type AttendantKnowledge = {
  title: string
  snippet: string
}

// Resumo de um chamado do PRÓPRIO contato, injetado no contexto pelo balcão
// (já filtrado por contactId). O LLM nunca recebe chamados de outros clientes.
export type AttendantTicketSummary = {
  subject: string
  status: string
}

export type AttendantInput = {
  tenant: { slug: string; name: string }
  companyRules: string[]
  // Nomes das tools HABILITADAS para este tenant (mesma lista que o validador honra).
  // O prompt precisa saber: pedir uma action que o balcão vai descartar só produz
  // resposta mentirosa ("já registrei") com nada gravado.
  //
  // `ToolName`, não `string[]`: o prompt decide o que anunciar comparando com um literal,
  // e num array de string um `'abrir_chamados'` digitado errado compila, devolve false e
  // silenciosamente esconde a ferramenta de um tenant que a tem. `readonly` porque a
  // lista é do balcão — provider recebe para ler, não para alterar.
  enabledTools: readonly ToolName[]
  knowledge: AttendantKnowledge[]
  history: AttendantHistoryTurn[]
  lead: AttendantLeadSnapshot | null
  myTickets: AttendantTicketSummary[]
  // Horários livres (ISO, fuso -03:00) que o balcão aceita. Só vem se o tenant tem agenda.
  agenda?: { freeSlots: string[] }
  message: string
}

// Campos do Lead que o atendente pode sugerir atualizar. Espelha o schema Prisma.
export const LEAD_PATCH_KEYS = ['name', 'phone', 'neighborhood', 'need', 'urgency'] as const
export type LeadPatchKey = (typeof LEAD_PATCH_KEYS)[number]
export type AttendantLeadPatch = Partial<Record<LeadPatchKey, string>>

// Ação que o atendente PROPÕE; o balcão valida e executa (a IA não toca o banco).
export type AbrirChamadoAction = {
  type: 'abrir_chamado'
  subject: string
  description: string
  category?: string
}

// Agenda: a IA só pede; o balcão confere o horário e marca (app/lib/agenda/pedido.ts).
export type PedirAgendamentoAction = {
  type: 'pedir_agendamento'
  operation: 'agendar' | 'remarcar' | 'cancelar'
  service?: string
  start?: string
}

export type AttendantAction = AbrirChamadoAction | PedirAgendamentoAction

export type AttendantOutput = {
  reply: string
  needsHuman: boolean
  handoffReason: string | null
  leadPatch: AttendantLeadPatch | null
  confidence: number
  action: AttendantAction | null
}

export interface AttendantProvider {
  readonly name: string
  generate(input: AttendantInput): Promise<AttendantOutput>
}
