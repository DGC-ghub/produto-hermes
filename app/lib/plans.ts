// Catálogo de planos — PURO, sem banco, para poder ser lido também no navegador.
// Mora fora de subscription.server.ts porque a landing (rota pública, sem sessão)
// precisa mostrar o preço: até aqui ele só existia atrás do login, e quem chegava
// pela primeira vez não descobria quanto custa sem criar conta.

/** Preço em centavos de real. */
export const PLANS = {
  essencial: {
    id: 'essencial',
    nome: 'Essencial',
    precoCentavos: 14900,
    destaque: false,
    resumo: 'Para quem tem um número e quer parar de perder mensagem.',
    features: [
      'Atendente de WhatsApp com IA',
      'Base de conhecimento própria',
      'Escalação para humano',
      'Um número de WhatsApp',
    ],
  },
  pro: {
    id: 'pro',
    nome: 'Pro',
    precoCentavos: 29900,
    destaque: true,
    resumo: 'Para quem atende em mais de um número e acompanha de perto.',
    features: [
      'Tudo do Essencial',
      'Vários números de WhatsApp',
      'Dashboard completo',
      'Suporte prioritário',
    ],
  },
} as const

export type PlanId = keyof typeof PLANS

/** Dias de teste antes da primeira cobrança. */
export const TRIAL_DAYS = 14

/** Formata centavos como preço cheio em reais ("14900" → "R$ 149"). Puro. */
export function formatPlanPrice(precoCentavos: number): string {
  const reais = precoCentavos / 100
  const inteiro = Number.isInteger(reais)
  return `R$ ${reais.toLocaleString('pt-BR', {
    minimumFractionDigits: inteiro ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}
