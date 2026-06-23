import type { AttendantInput, AttendantOutput, AttendantProvider } from '../types'

const HUMAN_HINTS = ['humano', 'atendente', 'pessoa', 'falar com alguem']
const TICKET_HINTS = ['chamado', 'abrir', 'solicitacao', 'solicitar', 'reclamacao']

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function includesAny(value: string, hints: string[]): boolean {
  const normalized = normalize(value)
  return hints.some((hint) => normalized.includes(hint))
}

/**
 * Provider de teste (sem IA): resposta determinística para validar o fluxo
 * inteiro — balcão → atendente → validador → banco → tela — sem credencial.
 */
export const mockProvider: AttendantProvider = {
  name: 'mock',
  async generate(input: AttendantInput): Promise<AttendantOutput> {
    if (includesAny(input.message, HUMAN_HINTS)) {
      return {
        reply: 'Claro, vou te encaminhar para uma pessoa do time. Pode aguardar um instante?',
        needsHuman: true,
        handoffReason: 'cliente_pediu_humano',
        leadPatch: null,
        confidence: 0.9,
        action: null,
      }
    }

    if (includesAny(input.message, TICKET_HINTS)) {
      return {
        reply:
          'Certo! Vou registrar um chamado com o que você descreveu e o time retorna em breve.',
        needsHuman: false,
        handoffReason: null,
        leadPatch: null,
        confidence: 0.6,
        action: {
          type: 'abrir_chamado',
          subject: input.message.replace(/`/g, '').slice(0, 60),
          description: input.message,
        },
      }
    }

    const echo = input.message.replace(/`/g, '').slice(0, 120)
    const foundHint = input.knowledge.length > 0 ? 'Achei algo na nossa base que ajuda. ' : ''
    return {
      reply: `Oi! Recebi sua mensagem: "${echo}". ${foundHint}Como posso te ajudar?`,
      needsHuman: false,
      handoffReason: null,
      leadPatch: null,
      confidence: 0.5,
      action: null,
    }
  },
}
