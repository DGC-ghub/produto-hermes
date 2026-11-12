import { parsePedido } from '../agenda/pedido'
import {
  type AttendantAction,
  type AttendantLeadPatch,
  type AttendantOutput,
  LEAD_PATCH_KEYS,
} from './types'

// Promessas que o atendente nunca pode fazer (regra de negócio GLOBAL, igual para
// todos). O TenantConfig pode somar mais via policy.extraForbiddenClaims.
const FORBIDDEN_CLAIMS = [
  '100% garantido',
  'garantia total',
  'conserto garantido',
  'resultado garantido',
  'sem nenhum risco',
]

// Sinais de vazamento de segredo ou tentativa de comando que nunca podem sair
// numa resposta ao cliente. Se aparecerem, a resposta é descartada.
const LEAK_PATTERNS: RegExp[] = [
  /sk-[a-z0-9]/i,
  /\/home\//,
  /\.env\b/i,
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /begin (?:rsa|openssh) private key/i,
]

// Reply (normalizado) que afirma registro consumado ou em curso. Formas em aberto
// ("posso registrar?", "vou registrar") NÃO casam — condicional é oferta, não registro.
const CLAIMS_TICKET_OPENED =
  /\b(?:registrei|registramos|registrad[oa]|registrando)\b|\babri (?:o|um) chamado\b|\bchamado (?:foi )?abert[oa]\b/

const MAX_REPLY_LENGTH = 2000
const MAX_LEAD_VALUE_LENGTH = 120
const MAX_SUBJECT_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 2000
const MAX_CATEGORY_LENGTH = 80

// Limites de uma tool habilitada (vêm do TenantConfig). O balcão honra estes
// limites no validador — a IA não os corrige nem contorna.
export type ToolPolicy = {
  name: string
  limits?: {
    requiredFields?: string[]
    allowedCategories?: string[]
  }
}

// Regras do tenant aplicadas determinísticamente pelo balcão (vêm do TenantConfig).
export type TenantPolicy = {
  extraForbiddenClaims?: string[]
  // Itens/serviços que a empresa NÃO atende: um chamado (action) que cite qualquer
  // um destes é descartado. Lista por tenant (vem do config), nunca no código.
  outOfScope?: string[]
  tools?: ToolPolicy[]
}

export type ValidationResult = { ok: true; value: AttendantOutput } | { ok: false; reason: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

// Negação ANTES da frase proibida, na MESMA CLÁUSULA: "não fazemos diagnóstico" é
// a resposta CERTA (rejeitá-la derrubava a mensagem inteira pro fallback — falso
// positivo grave no tenant de saúde). O escopo da negação quebra em pontuação de
// cláusula (,;:—) e em conjunção (e/ou/mas/porém...): "Não fazemos cirurgia, e o
// diagnóstico é gripe" NÃO está negado (achado alta da revisão adversarial).
// Viés de segurança: na dúvida, rejeita — falso positivo vira fallback + alarme;
// falso negativo viraria promessa proibida entregue ao cliente.
const NEGATION_BEFORE =
  /\b(?:nao|nunca|jamais|nem|sem)\b(?:(?!\b(?:mas|porem|contudo|entretanto|e|ou)\b)[^.!?\n,;:()—–-]){0,60}$/

function claimIsNegated(normalizedReply: string, index: number): boolean {
  return NEGATION_BEFORE.test(normalizedReply.slice(Math.max(0, index - 80), index))
}

/**
 * A frase proibida aparece de forma AFIRMATIVA em algum lugar da resposta?
 * Ocorrências negadas ("não fazemos X") não contam; basta uma afirmativa pra valer.
 * Recebe reply e claim já normalizados.
 */
function hasAffirmativeClaim(normalizedReply: string, claim: string): boolean {
  let index = normalizedReply.indexOf(claim)
  while (index !== -1) {
    if (!claimIsNegated(normalizedReply, index)) {
      return true
    }
    index = normalizedReply.indexOf(claim, index + claim.length)
  }
  return false
}

// Sanitiza o leadPatch: mantém só as chaves permitidas com valor de texto, truncando
// valores longos. Campos extras ou inválidos são IGNORADOS — nunca invalidam a resposta
// inteira (o lead é enriquecimento, não o conteúdo principal).
function sanitizeLeadPatch(raw: unknown): AttendantLeadPatch | null {
  if (!isPlainObject(raw)) {
    return null
  }
  const patch: AttendantLeadPatch = {}
  for (const [key, value] of Object.entries(raw)) {
    if (
      (LEAD_PATCH_KEYS as readonly string[]).includes(key) &&
      typeof value === 'string' &&
      value.trim().length > 0
    ) {
      patch[key as keyof AttendantLeadPatch] = value.trim().slice(0, MAX_LEAD_VALUE_LENGTH)
    }
  }
  return Object.keys(patch).length > 0 ? patch : null
}

// Confidence é informativo: clampa para [0,1] em vez de rejeitar a resposta.
function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.5
  }
  return Math.min(1, Math.max(0, value))
}

// Pedido de agenda: tool habilitada + formato válido + serviço dentro do escopo. A checagem
// do horário (livre, sem dupla marcação) é do balcão, na hora de executar.
function validatePedidoAgenda(
  raw: unknown,
  tools?: ToolPolicy[],
  outOfScope?: string[],
): AttendantAction | null {
  if (!tools?.some((tool) => tool.name === 'pedir_agendamento')) {
    return null
  }
  const pedido = parsePedido(raw)
  if (!pedido) {
    return null
  }
  const collapse = (value: string) => normalize(value).replace(/[\s-]+/g, '')
  const servico = collapse(pedido.service ?? '')
  if (outOfScope?.some((term) => collapse(term).length > 0 && servico.includes(collapse(term)))) {
    return null
  }
  return { type: 'pedir_agendamento', ...pedido }
}

// Ação inválida, ausente, de tool não habilitada, ou que viola os limites da tool
// (allowedCategories / requiredFields) vira null (descartada) — nunca invalida a
// resposta inteira. A IA propõe; o balcão honra o contrato declarado no config.
function validateAction(
  raw: unknown,
  tools?: ToolPolicy[],
  outOfScope?: string[],
): AttendantAction | null {
  if (isPlainObject(raw) && raw.type === 'pedir_agendamento') {
    return validatePedidoAgenda(raw, tools, outOfScope)
  }
  if (!isPlainObject(raw) || raw.type !== 'abrir_chamado') {
    return null
  }
  const toolPolicy = tools?.find((tool) => tool.name === 'abrir_chamado')
  if (tools && !toolPolicy) {
    return null // tool não habilitada para este tenant
  }

  const { subject, description, category } = raw
  if (typeof subject !== 'string' || subject.trim().length === 0) {
    return null
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    return null
  }
  let cat = typeof category === 'string' && category.trim().length > 0 ? category.trim() : undefined

  const limits = toolPolicy?.limits
  // allowedCategories: categoria fora da lista DERRUBA SÓ A CATEGORIA, não a
  // action — descartar o registro inteiro por um rótulo inválido matou um chamado
  // real na prova de 2026-07-03 ("escala_medica" ≠ "demanda_escala") e o cliente
  // ouviria "registrei" com nada no banco. Se o tenant EXIGE categoria
  // (requiredFields), a checagem abaixo ainda barra a action sem categoria válida.
  if (limits?.allowedCategories && limits.allowedCategories.length > 0 && cat) {
    if (!limits.allowedCategories.includes(cat)) {
      cat = undefined
    }
  }
  // requiredFields: cada campo obrigatório precisa estar presente e não-vazio.
  if (limits?.requiredFields && limits.requiredFields.length > 0) {
    const fields: Record<string, string | undefined> = {
      subject: subject.trim(),
      description: description.trim(),
      category: cat,
    }
    for (const field of limits.requiredFields) {
      const value = fields[field]
      if (typeof value !== 'string' || value.trim().length === 0) {
        return null
      }
    }
  }

  const action: AttendantAction = {
    type: 'abrir_chamado',
    subject: subject.trim().slice(0, MAX_SUBJECT_LENGTH),
    description: description.trim().slice(0, MAX_DESCRIPTION_LENGTH),
  }
  if (cat) {
    action.category = cat.slice(0, MAX_CATEGORY_LENGTH)
  }

  // Guard-rail de escopo (determinístico, por tenant): a IA não pode AGENDAR/abrir
  // chamado para um item que a empresa declara NÃO atender. Se o assunto/descrição/
  // categoria citar um termo fora do escopo, a action é descartada — o cliente nunca
  // recebe uma visita marcada pra algo que a empresa não faz. A recusa conversacional
  // ("recusar-e-seguir") fica com o prompt; aqui é a rede determinística do balcão.
  if (outOfScope && outOfScope.length > 0) {
    // Colapsa hífens/espaços além de acento/caixa: um único termo "micro-ondas"
    // pega também "microondas" e "micro ondas" (a IA escreve as três formas).
    const collapse = (value: string) => normalize(value).replace(/[\s-]+/g, '')
    const haystack = collapse(`${action.subject} ${action.description} ${action.category ?? ''}`)
    const hitsOutOfScope = outOfScope.some((term) => {
      const collapsedTerm = collapse(term)
      // Termo vazio/só-espaço jamais casa (senão derrubaria toda action).
      return collapsedTerm.length > 0 && haystack.includes(collapsedTerm)
    })
    if (hitsOutOfScope) {
      return null
    }
  }
  return action
}

/**
 * Valida (camada determinística) a saída do atendente antes de salvar/enviar.
 * Função pura. Aplica os guard-rails globais + os do tenant (policy). Rejeita
 * objeto malformado, reply vazio/longo/com código, vazamento de segredo, promessa
 * proibida ou handoff incoerente. Campos de enriquecimento são saneados em vez de
 * rejeitar a resposta: leadPatch perde chaves inválidas, confidence é clampado em
 * [0,1], e ação inválida/não-habilitada/que viola limites vira null.
 */
export function validateAttendantOutput(raw: unknown, policy?: TenantPolicy): ValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'nao_e_objeto' }
  }

  const { reply, needsHuman, handoffReason, leadPatch, confidence, action } = raw

  if (typeof reply !== 'string' || reply.trim().length === 0) {
    return { ok: false, reason: 'reply_vazio' }
  }
  if (reply.length > MAX_REPLY_LENGTH) {
    return { ok: false, reason: 'reply_longo' }
  }
  if (reply.includes('```')) {
    return { ok: false, reason: 'reply_tem_codigo' }
  }
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(reply)) {
      return { ok: false, reason: 'reply_vaza_segredo' }
    }
  }
  const normalizedReply = normalize(reply)
  const forbidden =
    policy?.extraForbiddenClaims && policy.extraForbiddenClaims.length > 0
      ? [...FORBIDDEN_CLAIMS, ...policy.extraForbiddenClaims]
      : FORBIDDEN_CLAIMS
  for (const claim of forbidden) {
    if (hasAffirmativeClaim(normalizedReply, normalize(claim))) {
      return { ok: false, reason: 'reply_promessa_proibida' }
    }
  }

  if (typeof needsHuman !== 'boolean') {
    return { ok: false, reason: 'needsHuman_invalido' }
  }
  if (handoffReason !== null && typeof handoffReason !== 'string') {
    return { ok: false, reason: 'handoffReason_invalido' }
  }
  if (needsHuman && (typeof handoffReason !== 'string' || handoffReason.trim().length === 0)) {
    return { ok: false, reason: 'handoff_sem_motivo' }
  }

  const validatedAction = validateAction(action, policy?.tools, policy?.outOfScope)

  // A IA não pode AFIRMAR que registrou/abriu chamado sem uma action VÁLIDA: o
  // cliente acharia que está registrado e não está (visto ao vivo na prova de
  // 2026-07-03 — "Já registrei sua solicitação" com action null). Vale SEMPRE, e
  // não só quando o tenant tem a tool: sem a tool nada pode ser registrado, então
  // a frase é mentira certa (tenant novo do /signup nasce com `tools: []`).
  // Rejeitar aqui degrada pro fallback honesto, que escala para humano.
  if (validatedAction?.type !== 'abrir_chamado' && CLAIMS_TICKET_OPENED.test(normalizedReply)) {
    return { ok: false, reason: 'reply_afirma_registro_sem_action' }
  }

  return {
    ok: true,
    value: {
      reply: reply.trim(),
      needsHuman,
      handoffReason: needsHuman ? handoffReason : null,
      leadPatch: sanitizeLeadPatch(leadPatch),
      confidence: clampConfidence(confidence),
      action: validatedAction,
    },
  }
}
