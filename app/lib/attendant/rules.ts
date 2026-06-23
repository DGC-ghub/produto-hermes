// Regras de negócio passadas ao atendente como guardrails (a "coleira" de conteúdo).
// O provider real (fase 2.3+) usa isto no prompt; o mock ignora. Decisão aberta 3:
// por enquanto um tom base + um complemento por empresa.

const BASE_RULES = [
  'Responda em português, de forma curta, natural e cordial.',
  'Use apenas as informações da base da empresa; não invente dados.',
  'Nunca prometa preço fechado, garantia de conserto ou prazo que não esteja na base.',
  'Se não souber responder com segurança, ou se o tema for sensível (contrato, jurídico, dados pessoais), peça para encaminhar a um humano.',
  'Se o cliente pedir para falar com uma pessoa, encaminhe sem insistir.',
]

const TENANT_RULES: Record<string, string[]> = {
  'assistencia-tecnica-demo': [
    'Para orientar melhor, pergunte o bairro, o equipamento e o que aconteceu.',
  ],
  dgc: ['Pergunte sobre o processo da pessoa e o que ela precisa resolver.'],
  prestacon: [
    'Explique termos contábeis de forma simples; o cliente pode não ser da área.',
    'Para análises (regime tributário, abertura de empresa, planejamento), ofereça agendar uma reunião com um contador.',
    'Nunca comente sobre outros clientes nem compartilhe dados de terceiros.',
  ],
}

export function companyRulesFor(slug: string): string[] {
  return [...BASE_RULES, ...(TENANT_RULES[slug] ?? [])]
}
