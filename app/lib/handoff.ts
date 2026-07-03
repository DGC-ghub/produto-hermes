export type HandoffDecision = {
  needsHuman: boolean
  reason?: string
}

// Gatilhos já em forma normalizada (minúsculas, sem acento), pois a mensagem é normalizada antes do match.
// 'pessoa' solto SAIU: no home care (csmed), "preciso de uma pessoa pra cuidar da
// minha mãe" é o lead mais valioso do tenant — escalar isso como pedido de humano
// sequestrava a venda. Pedido de gente vira frase com contexto ('falar com...').
const REQUESTED_HUMAN_PHRASES = [
  'humano',
  'atendente',
  'falar com pessoa',
  'falar com uma pessoa',
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

// Escapa metacaracteres de regex — um trigger de tenant com '(' ou '+' no JSON não
// pode derrubar o guard de TODA mensagem (mesmo padrão do lead.ts).
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Match por palavra inteira: evita falso positivo de substring (ex.: 'pessoa' dentro de
// 'dados pessoais'/'pessoal'), garantindo que todos os gatilhos sejam alcançáveis.
// Tolera plural simples em cada palavra ('dor'→'dores', 'exame'→'exames', 'dor no
// peito'→'dores no peito'): a vertical saúde fala no plural, e sem isto o guard
// determinístico viraria promessa falsa. Plural irregular (medicação→medicações)
// entra como trigger explícito no config do tenant.
function includesAny(value: string, phrases: string[]): boolean {
  return phrases.some((phrase) => {
    const words = phrase
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .map(escapeRegex)
    if (words.length === 0) {
      return false
    }
    const pattern = words.map((word) => `${word}(?:e?s)?`).join('\\s+')
    // Lookarounds em vez de \b: \b falha quando a borda do trigger é um símbolo
    // (ex.: 'pressao (alta)' termina em ')'). Pra palavras, o efeito é o mesmo.
    return new RegExp(`(?<!\\w)${pattern}(?!\\w)`).test(value)
  })
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
