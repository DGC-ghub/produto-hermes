export type HandoffDecision = {
  needsHuman: boolean
  reason?: string
}

// Gatilhos já em forma normalizada (minúsculas, sem acento), pois a mensagem é normalizada antes do match.
const REQUESTED_HUMAN_PHRASES = [
  'humano',
  'atendente',
  'pessoa',
  'falar com alguem',
  'alguem do time',
]

// Gatilhos sensíveis GLOBAIS (valem para todo tenant). "processo" saiu daqui: é
// ambíguo — "processo judicial" é sensível, mas "processo de vendas/operacional" é
// justamente o que uma software house atende, e escalava lead bom por engano. Quem
// precisar dele (ex.: advogado) adiciona via TenantConfig.escalationPolicy.triggers.
const SENSITIVE_PHRASES = ['contrato', 'lgpd', 'juridico', 'dados pessoais']

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

// Match por palavra inteira: evita falso positivo de substring (ex.: 'pessoa' dentro de
// 'dados pessoais'/'pessoal'), garantindo que todos os gatilhos sejam alcançáveis.
function includesAny(value: string, phrases: string[]): boolean {
  return phrases.some((phrase) => new RegExp(`\\b${phrase}\\b`).test(value))
}

/**
 * Decide se o Hermes deve passar a conversa para um humano.
 * Função pura e determinística — sem banco, fs, API ou LLM.
 *
 * Precedência: requested_human > sensitive_topic > no_knowledge_match > sem handoff.
 */
export function decideHandoff(input: {
  message: string
  retrievedCount: number
  extraSensitiveTriggers?: string[]
}): HandoffDecision {
  const message = normalizeText(input.message)

  if (includesAny(message, REQUESTED_HUMAN_PHRASES)) {
    return { needsHuman: true, reason: 'requested_human' }
  }
  // Gatilhos sensíveis globais + os declarados no TenantConfig (escalationPolicy).
  const sensitive =
    input.extraSensitiveTriggers && input.extraSensitiveTriggers.length > 0
      ? [...SENSITIVE_PHRASES, ...input.extraSensitiveTriggers.map(normalizeText)]
      : SENSITIVE_PHRASES
  if (includesAny(message, sensitive)) {
    return { needsHuman: true, reason: 'sensitive_topic' }
  }
  if (input.retrievedCount <= 0) {
    return { needsHuman: true, reason: 'no_knowledge_match' }
  }
  return { needsHuman: false }
}
