import type { RetrievedChunk } from './retrieval'

export type AssistantDecision = {
  reply: string
  confidence: number
  sources: RetrievedChunk[]
  needsHuman: boolean
  handoffReason?: string
}

const FORBIDDEN_CLAIMS = ['garantido', 'certeza', '100%', 'definitivo']

const NEXT_STEP_TRIGGERS = [
  'orcamento',
  'agendar',
  'agenda',
  'visita',
  'problema',
  'parou',
  'nao funciona',
  'geladeira',
  'maquina',
  'ar-condicionado',
]

const CLOSED_PRICE_TRIGGERS = ['preco fechado', 'valor final', 'quanto fica', 'fechar valor']

const NO_SOURCE_REPLY =
  'Não encontrei essa informação na base. Vou marcar para uma pessoa do time te ajudar com segurança. Pode me dar mais contexto enquanto isso?'

const CLOSED_PRICE_NOTE =
  'Só não consigo fechar um valor final por aqui; ele depende da avaliação e da proposta.'

// Default neutro quando o tenant não define um `nextStepPrompt` próprio no config.
const NEXT_STEP_DEFAULT =
  'Para eu te orientar melhor, me conta um pouco do seu processo e o que você precisa resolver.'

const CLOSING_OFFER = 'Se quiser, posso encaminhar para uma pessoa do time.'

const MAX_SNIPPET_CHARS = 280

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function includesAny(value: string, phrases: string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compactSnippet(snippet: string): string {
  return snippet.replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET_CHARS)
}

// Guardrail: nunca deixar a resposta afirmar garantia/certeza absoluta, mesmo que o
// trecho citado da base contenha esses termos.
function stripForbiddenClaims(text: string): string {
  let result = text
  for (const claim of FORBIDDEN_CLAIMS) {
    result = result.replace(new RegExp(escapeRegExp(claim), 'gi'), '')
  }
  return result.replace(/\s+/g, ' ').trim()
}

/**
 * Monta uma resposta inicial determinística do Hermes a partir dos trechos encontrados.
 * Função pura — sem banco, fs, API ou LLM. Não inventa informação fora dos sources.
 */
export function composeAssistantResponse(input: {
  userMessage: string
  sources: RetrievedChunk[]
  // Orientação de próximo passo específica do tenant (vem do TenantConfig); ausente
  // → default neutro. O motor NÃO conhece o vertical — recebe o texto pronto.
  nextStepPrompt?: string
}): AssistantDecision {
  if (input.sources.length === 0) {
    return {
      reply: NO_SOURCE_REPLY,
      confidence: 0,
      sources: [],
      needsHuman: true,
      handoffReason: 'no_knowledge_match',
    }
  }

  const top = input.sources[0]
  const message = normalizeText(input.userMessage)

  const parts = [compactSnippet(top.snippet)]
  if (includesAny(message, CLOSED_PRICE_TRIGGERS)) {
    parts.push(CLOSED_PRICE_NOTE)
  }
  if (includesAny(message, NEXT_STEP_TRIGGERS)) {
    parts.push(input.nextStepPrompt?.trim() || NEXT_STEP_DEFAULT)
  }
  parts.push(CLOSING_OFFER)

  const reply = stripForbiddenClaims(parts.filter((part) => part.length > 0).join(' '))
  const confidence = Math.min(0.95, 0.45 + top.score * 0.1)

  return {
    reply,
    confidence,
    sources: input.sources,
    needsHuman: false,
  }
}
