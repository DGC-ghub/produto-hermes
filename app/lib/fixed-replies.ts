import type { FixedReply } from './attendant/tenant-config'
import { matchesAnyTrigger } from './handoff'

export type FixedReplyMatch = {
  id: string
  reply: string
  /** A pessoa repetiu a pergunta que esta resposta já tinha respondido: passa para humano. */
  escalate: boolean
  register: boolean
}

/**
 * Resposta em texto fixo para a mensagem, se alguma casar. Pura e determinística: o texto sai
 * EXATAMENTE como está na config (é assim que o preço nunca passa pela IA). A primeira da
 * lista que casar vale.
 */
export function matchFixedReply(
  replies: FixedReply[] | undefined,
  message: string,
  lastAssistantMessage: string | undefined,
): FixedReplyMatch | null {
  for (const item of replies ?? []) {
    if (!matchesAnyTrigger(message, item.triggers)) {
      continue
    }
    return {
      id: item.id,
      reply: item.reply,
      escalate: item.escalateIfRepeated === true && lastAssistantMessage === item.reply,
      register: item.register === true,
    }
  }
  return null
}
