// Contrato do "Hermes Atendente" — o cérebro plugável do Produto Hermes.
// O balcão (processIncomingMessage) monta o AttendantInput, chama um provider e
// recebe um AttendantOutput já validado. Nenhuma parte do produto sabe qual
// provider está ativo (mock | claude_cli).

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
  knowledge: AttendantKnowledge[]
  history: AttendantHistoryTurn[]
  lead: AttendantLeadSnapshot | null
  myTickets: AttendantTicketSummary[]
  message: string
}

// Campos do Lead que o atendente pode sugerir atualizar. Espelha o schema Prisma.
export const LEAD_PATCH_KEYS = ['name', 'phone', 'neighborhood', 'need', 'urgency'] as const
export type LeadPatchKey = (typeof LEAD_PATCH_KEYS)[number]
export type AttendantLeadPatch = Partial<Record<LeadPatchKey, string>>

// Ação que o atendente PROPÕE; o balcão valida e executa (a IA não toca o banco).
export type AttendantAction = {
  type: 'abrir_chamado'
  subject: string
  description: string
  category?: string
}

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
