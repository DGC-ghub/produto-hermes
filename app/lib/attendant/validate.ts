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
  tools?: ToolPolicy[]
}

export type ValidationResult = { ok: true; value: AttendantOutput } | { ok: false; reason: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function validateLeadPatch(raw: unknown): AttendantLeadPatch | null | 'invalid' {
  if (raw === null || raw === undefined) {
    return null
  }
  if (!isPlainObject(raw)) {
    return 'invalid'
  }
  const patch: AttendantLeadPatch = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!(LEAD_PATCH_KEYS as readonly string[]).includes(key)) {
      return 'invalid'
    }
    if (typeof value !== 'string' || value.length > MAX_LEAD_VALUE_LENGTH) {
      return 'invalid'
    }
    patch[key as keyof AttendantLeadPatch] = value
  }
  return patch
}

// Ação inválida, ausente, de tool não habilitada, ou que viola os limites da tool
// (allowedCategories / requiredFields) vira null (descartada) — nunca invalida a
// resposta inteira. A IA propõe; o balcão honra o contrato declarado no config.
function validateAction(raw: unknown, tools?: ToolPolicy[]): AttendantAction | null {
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
  const cat =
    typeof category === 'string' && category.trim().length > 0 ? category.trim() : undefined

  const limits = toolPolicy?.limits
  // allowedCategories: se uma categoria foi fornecida, ela precisa estar na lista.
  if (limits?.allowedCategories && limits.allowedCategories.length > 0 && cat) {
    if (!limits.allowedCategories.includes(cat)) {
      return null
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
  return action
}

/**
 * Valida (camada determinística) a saída do atendente antes de salvar/enviar.
 * Função pura. Aplica os guard-rails globais + os do tenant (policy). Rejeita
 * objeto malformado, vazamento de segredo, promessa proibida, handoff incoerente
 * ou confidence fora de [0,1]. Ação inválida/não-habilitada/que viola limites é
 * descartada (vira null), sem invalidar a resposta.
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
    if (normalizedReply.includes(normalize(claim))) {
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

  const patch = validateLeadPatch(leadPatch)
  if (patch === 'invalid') {
    return { ok: false, reason: 'leadPatch_invalido' }
  }

  if (
    typeof confidence !== 'number' ||
    Number.isNaN(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return { ok: false, reason: 'confidence_invalido' }
  }

  return {
    ok: true,
    value: {
      reply: reply.trim(),
      needsHuman,
      handoffReason: needsHuman ? handoffReason : null,
      leadPatch: patch,
      confidence,
      action: validateAction(action, policy?.tools),
    },
  }
}
