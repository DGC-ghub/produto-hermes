// Agenda da clínica. Todo horário é um texto ISO com fuso de Brasília (-03:00).
// A IA nunca fala com a agenda: ela propõe, o balcão chama o AgendaProvider.

export type AppointmentStatus = 'agendado' | 'confirmado' | 'cancelado'

export type Appointment = {
  id: string
  // Referência opaca do paciente (o contactId do canal). Nunca CPF, telefone ou dado de saúde.
  patientRef: string
  service: string
  start: string
  end: string
  status: AppointmentStatus
}

export type BookInput = { patientRef: string; service: string; start: string }

export type DayHours = {
  open: string // 'HH:MM'
  close: string
  lunch?: { from: string; to: string }
}

// Contrato único: a demo usa a versão em memória; o piloto troca pelo Google Agenda
// sem mexer no resto (ver docs/entrega/DEMO_HERMES_CLINICA.md).
export interface AgendaProvider {
  readonly name: string
  freeSlots(day: string): Promise<string[]>
  book(input: BookInput): Promise<Appointment>
  reschedule(id: string, newStart: string, patientRef?: string): Promise<Appointment>
  cancel(id: string, patientRef?: string): Promise<Appointment>
  confirm(id: string, patientRef?: string): Promise<Appointment>
  list(): Promise<Appointment[]>
}
