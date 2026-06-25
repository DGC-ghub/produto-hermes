// Transições de status de uma conversa quando o ATENDENTE humano age na tela
// /atendente. Função pura e determinística — o balcão (action) decide a partir
// daqui, validando a transição antes de tocar o banco.
//
// Ciclo: open (Hermes cuidando) → needs_human (Hermes escalou, na fila) →
// human (humano assumiu; o Hermes para de responder aquele cliente) →
// open (devolvido ao Hermes) | closed (encerrado).

export type ConversationAction = 'assumir' | 'devolver' | 'encerrar'

const TRANSITIONS: Record<ConversationAction, { from: readonly string[]; to: string }> = {
  assumir: { from: ['open', 'needs_human'], to: 'human' },
  devolver: { from: ['human'], to: 'open' },
  encerrar: { from: ['open', 'needs_human', 'human'], to: 'closed' },
}

export const CONVERSATION_ACTIONS: readonly ConversationAction[] = [
  'assumir',
  'devolver',
  'encerrar',
]

export function isConversationAction(value: string): value is ConversationAction {
  return (CONVERSATION_ACTIONS as readonly string[]).includes(value)
}

/**
 * Status resultante de aplicar uma ação ao status atual, ou `null` se a transição
 * não é permitida (ex.: devolver uma conversa que não foi assumida).
 */
export function nextConversationStatus(current: string, action: ConversationAction): string | null {
  const transition = TRANSITIONS[action]
  return transition.from.includes(current) ? transition.to : null
}

// Quando o humano assumiu a conversa, o Hermes NÃO deve responder àquele cliente
// (o atendente está cuidando). O motor usa isto para se calar.
export function isHumanHandling(status: string): boolean {
  return status === 'human'
}
