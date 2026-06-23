import type { TenantConfig } from './tenant-config'

// Regras globais de atendimento (a "coleira" de conteúdo, igual para todos).
// O que é por-empresa vem do TenantConfig (extraRules, sourcePolicy).
const BASE_RULES = [
  'Responda em português, de forma curta, natural e cordial.',
  'Use apenas as informações da base da empresa; não invente dados.',
  'Nunca prometa preço fechado, garantia de conserto ou prazo que não esteja na base.',
  'Se não souber responder com segurança, ou se o tema for sensível (contrato, jurídico, dados pessoais), peça para encaminhar a um humano.',
  'Se o cliente pedir para falar com uma pessoa, encaminhe sem insistir.',
]

/**
 * Deriva as regras de atendimento (orientação para o prompt) a partir do
 * TenantConfig: regras globais + política de fonte + as regras livres da empresa.
 * Substitui o antigo `companyRulesFor` (que tinha um Record hard-coded por slug).
 */
export function buildCompanyRules(config: TenantConfig): string[] {
  const rules = [...BASE_RULES]
  if (config.knowledge.sourcePolicy === 'answer_only_from_knowledge') {
    rules.push(
      'Responda somente com base nas informações da empresa. Se algo não estiver na base, diga que vai verificar ou encaminhar — não invente.',
    )
  }
  rules.push(...(config.extraRules ?? []))
  return rules
}
