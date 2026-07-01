import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// TenantConfig: a descrição declarativa de COMO cada empresa funciona. Um motor
// (código) único; o que muda entre clientes é só este dado + a knowledge base.
// O cliente nunca escreve comportamento — preenche campos e sobe documentos.

export type TenantObjective =
  | 'tirar_duvidas'
  | 'qualificar_lead'
  | 'agendar'
  | 'abrir_chamado'
  | 'vender'

export type ToolName = 'abrir_chamado' | 'consultar_chamados' | 'pedir_agendamento'

export type ToolConfig = {
  name: ToolName
  enabled: boolean
  limits?: {
    requireConfirmation?: boolean
    requiredFields?: string[]
    allowedCategories?: string[]
    maxPriority?: 'baixa' | 'media' | 'alta'
  }
}

export type TenantConfig = {
  slug: string
  businessProfile: {
    name: string
    segment: string
    tone: string
    workingHours?: string
    address?: string
  }
  // Orientação (a IA usa); não vira fluxo.
  objectives: TenantObjective[]
  knowledge: {
    sourceDir: string
    // answer_only_from_knowledge: orientação forte p/ não inventar fora da base.
    sourcePolicy: 'answer_only_from_knowledge' | 'allow_general_smalltalk'
  }
  // Catálogo FIXO no código; aqui só liga/desliga e limita por tenant.
  tools: ToolConfig[]
  // CRÍTICO — o balcão aplica determinístico (validador/handoff), nunca o prompt.
  guardrails: {
    neverPromise: string[] // somados ao FORBIDDEN_CLAIMS global do validador
    forbiddenTopics?: string[]
    maxDiscountPercent?: number
  }
  escalationPolicy: {
    triggers: string[]
    defaultReason: string
    humanMessage: string
  }
  // Regras livres por empresa (o TENANT_RULES de hoje, agora como dado).
  extraRules?: string[]
}

const SAFE_SLUG = /^[a-z0-9-]+$/
const CONFIG_DIR = join(process.cwd(), 'config', 'tenants')

function asObject(value: unknown, ctx: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`TenantConfig.${ctx} deve ser um objeto`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, ctx: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`TenantConfig.${ctx} deve ser uma string não-vazia`)
  }
  return value
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : []
}

/**
 * Valida e normaliza um TenantConfig cru (função pura, testável). Garante a forma
 * essencial; opcionais ausentes viram defaults seguros.
 */
export function parseTenantConfig(slug: string, raw: unknown): TenantConfig {
  const root = asObject(raw, 'root')
  const profile = asObject(root.businessProfile, 'businessProfile')
  const knowledge = asObject(root.knowledge, 'knowledge')
  const guardrails = asObject(root.guardrails, 'guardrails')
  const escalation = asObject(root.escalationPolicy, 'escalationPolicy')

  const sourcePolicy = knowledge.sourcePolicy
  if (sourcePolicy !== 'answer_only_from_knowledge' && sourcePolicy !== 'allow_general_smalltalk') {
    throw new Error('TenantConfig.knowledge.sourcePolicy inválido')
  }
  if (!Array.isArray(root.objectives)) {
    throw new Error('TenantConfig.objectives deve ser um array')
  }
  if (!Array.isArray(root.tools)) {
    throw new Error('TenantConfig.tools deve ser um array')
  }

  return {
    slug,
    businessProfile: {
      name: asString(profile.name, 'businessProfile.name'),
      segment: asString(profile.segment, 'businessProfile.segment'),
      tone: asString(profile.tone, 'businessProfile.tone'),
      workingHours: typeof profile.workingHours === 'string' ? profile.workingHours : undefined,
      address: typeof profile.address === 'string' ? profile.address : undefined,
    },
    objectives: root.objectives as TenantObjective[],
    knowledge: {
      sourceDir: asString(knowledge.sourceDir, 'knowledge.sourceDir'),
      sourcePolicy,
    },
    tools: root.tools as ToolConfig[],
    guardrails: {
      neverPromise: asStringArray(guardrails.neverPromise),
      forbiddenTopics: Array.isArray(guardrails.forbiddenTopics)
        ? asStringArray(guardrails.forbiddenTopics)
        : undefined,
      maxDiscountPercent:
        typeof guardrails.maxDiscountPercent === 'number'
          ? guardrails.maxDiscountPercent
          : undefined,
    },
    escalationPolicy: {
      triggers: asStringArray(escalation.triggers),
      defaultReason: asString(escalation.defaultReason, 'escalationPolicy.defaultReason'),
      humanMessage: asString(escalation.humanMessage, 'escalationPolicy.humanMessage'),
    },
    extraRules: root.extraRules !== undefined ? asStringArray(root.extraRules) : undefined,
  }
}

/**
 * Carrega o TenantConfig de `config/tenants/<slug>.json`. Server-side (lê arquivo).
 * Hoje a fonte é arquivo; na Fase 4 vira banco — só esta função muda, o resto não.
 */
export function loadTenantConfig(slug: string): TenantConfig {
  if (!SAFE_SLUG.test(slug)) {
    throw new Error(`Invalid tenant slug: ${slug}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(CONFIG_DIR, `${slug}.json`), 'utf8'))
  } catch {
    throw new Error(`TenantConfig não encontrado para: ${slug}`)
  }
  return parseTenantConfig(slug, raw)
}

/**
 * Serializa um TenantConfig para o JSON gravável em disco. O `slug` não vai no
 * arquivo (vem do nome do arquivo). Função pura — o roundtrip serialize → parse
 * preserva o config.
 */
export function serializeTenantConfig(config: TenantConfig): string {
  const { slug: _slug, ...rest } = config
  return `${JSON.stringify(rest, null, 2)}\n`
}

/**
 * Grava o TenantConfig em `config/tenants/<slug>.json`. Espelha loadTenantConfig:
 * o ÚNICO ponto de escrita. Revalida (parse do serializado) antes de gravar —
 * nunca persiste algo que não carregaria de volta. Server-side (escreve arquivo).
 */
export function saveTenantConfig(config: TenantConfig): void {
  if (!SAFE_SLUG.test(config.slug)) {
    throw new Error(`Invalid tenant slug: ${config.slug}`)
  }
  // Revalida pelo mesmo caminho do load: garante forma íntegra e normalizada.
  const validated = parseTenantConfig(config.slug, JSON.parse(serializeTenantConfig(config)))
  writeFileSync(
    join(CONFIG_DIR, `${validated.slug}.json`),
    serializeTenantConfig(validated),
    'utf8',
  )
}

/**
 * Config conservador de emergência — usado quando o config de um tenant está
 * ausente ou inválido. Degrada de forma SEGURA: sem ações, não inventa fora da
 * base e orienta a encaminhar para humano. Nunca cai em comportamento solto.
 */
export function safeDefaultConfig(slug: string): TenantConfig {
  return {
    slug,
    businessProfile: { name: slug, segment: 'não informado', tone: 'cordial e prudente' },
    objectives: ['tirar_duvidas'],
    knowledge: { sourceDir: `knowledge/${slug}`, sourcePolicy: 'answer_only_from_knowledge' },
    tools: [],
    guardrails: { neverPromise: [] },
    escalationPolicy: {
      triggers: [],
      defaultReason: 'config_indisponivel',
      humanMessage: 'Vou te encaminhar para uma pessoa do time te ajudar com segurança.',
    },
    extraRules: ['Na dúvida, encaminhe para um atendente humano.'],
  }
}
