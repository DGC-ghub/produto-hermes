export type LeadPatch = {
  need?: string
  urgency?: string
  neighborhood?: string
}

const NEED_MAX_CHARS = 180

// Termos já em forma normalizada (sem acento, minúsculas), pois a mensagem é
// normalizada antes do match. 'não funciona' e 'nao funciona' colapsam em um só.
const URGENCY_TERMS = ['urgente', 'hoje', 'agora', 'parou', 'nao funciona', 'sem funcionar']

// Bairros canônicos da demo — retornados com o acento correto.
const NEIGHBORHOODS = [
  'Centro',
  'Jardim América',
  'Jardim Europa',
  'Jardim Paulista',
  'Vila Nova',
  'Bela Vista',
  'Parque das Flores',
  'Santa Rosa',
]

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Match por palavra inteira para evitar falso positivo de substring.
function includesWord(haystack: string, needle: string): boolean {
  return new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(haystack)
}

function detectUrgency(message: string): string | undefined {
  const normalized = normalizeText(message)
  return URGENCY_TERMS.some((term) => includesWord(normalized, term)) ? 'alta' : undefined
}

function detectNeighborhood(message: string): string | undefined {
  const normalized = normalizeText(message)
  return NEIGHBORHOODS.find((name) => includesWord(normalized, normalizeText(name)))
}

/**
 * Extrai sinais simples de lead a partir da mensagem do usuário.
 * Função pura e determinística — sem banco, fs, API ou LLM. Não inventa dados:
 * só retorna campos efetivamente detectados. Não extrai nome/telefone nesta task.
 */
export function extractLeadPatch(message: string): LeadPatch {
  const patch: LeadPatch = {}

  const need = compactText(message).slice(0, NEED_MAX_CHARS)
  if (need.length > 0) {
    patch.need = need
  }

  const urgency = detectUrgency(message)
  if (urgency) {
    patch.urgency = urgency
  }

  const neighborhood = detectNeighborhood(message)
  if (neighborhood) {
    patch.neighborhood = neighborhood
  }

  return patch
}
