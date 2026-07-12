import type { TenantConfig } from './tenant-config'

// Regras globais de atendimento (a "coleira" de conteúdo, igual para todos).
// O que é por-empresa vem do TenantConfig (persona, extraRules, sourcePolicy).
const BASE_RULES = [
  'Responda em português, de forma curta e natural, como numa conversa de WhatsApp.',
  'Use apenas as informações da base da empresa; não invente dados, preços ou prazos.',
  'Nunca prometa preço fechado, garantia de conserto ou prazo que não esteja na base.',
  'Só abra um chamado (o campo action) DEPOIS que o cliente confirmar que quer agendar ou registrar; antes disso, ofereça e pergunte, mantendo action nula.',
  'Quando o cliente CONFIRMAR ("sim", "pode registrar"), inclua a action abrir_chamado NESSE MESMO turno — detalhe que faltar vai na description como "a confirmar". NUNCA diga que registrou/abriu algo sem a action correspondente: sem ela, nada é registrado de verdade.',
  'Diante de objeção de preço ou atrito leve, contorne com jeito e ofereça o próximo passo (ex.: a visita) — não encaminhe a um humano só por isso.',
  'Encaminhe a um humano apenas em: pedido explícito do cliente, insatisfação forte ou repetida, ou tema sensível (contrato, jurídico, dados pessoais).',
]

// Uma linha de persona derivada do businessProfile: dá ao cérebro a identidade
// e o tom DAQUELA empresa (antes só chegava o tom genérico das BASE_RULES).
function personaRule(config: TenantConfig): string {
  const { name, segment, tone, workingHours } = config.businessProfile
  const base = `Você é o atendente da ${name} (${segment}). Fale sempre neste tom: ${tone}.`
  return workingHours ? `${base} Horário de funcionamento: ${workingHours}.` : base
}

/**
 * Deriva as regras de atendimento (orientação para o prompt) a partir do
 * TenantConfig: persona da empresa + regras globais + política de fonte + as
 * regras livres da empresa. Substitui o antigo `companyRulesFor`.
 */
export function buildCompanyRules(config: TenantConfig): string[] {
  const rules = [personaRule(config), ...BASE_RULES]
  if (config.knowledge.sourcePolicy === 'answer_only_from_knowledge') {
    rules.push(
      'Responda somente com base nas informações da empresa. Se algo não estiver na base, diga que vai verificar ou encaminhar — não invente.',
    )
  }
  // Escopo negativo por empresa (dado, não código): "recusar-e-seguir". A lista
  // vem do TenantConfig; o balcão ainda barra, no validador, qualquer chamado
  // aberto para um item fora do escopo.
  const outOfScope = config.guardrails.outOfScope
  if (outOfScope && outOfScope.length > 0) {
    rules.push(
      `A empresa NÃO atende: ${outOfScope.join(', ')}. Se o cliente pedir um destes (ou algo fora do que está na base), diga com clareza e gentileza que a empresa não atende esse item e siga ajudando com o que ela faz. Nunca ofereça, agende ou diga que "dá pra avaliar" algo fora do escopo, nem cite isso como exemplo do que a empresa faz.`,
    )
  }
  rules.push(...(config.extraRules ?? []))
  return rules
}
