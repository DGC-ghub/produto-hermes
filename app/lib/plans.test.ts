import { describe, expect, it } from 'vitest'
import { formatPlanPrice, PLANS, TRIAL_DAYS } from './plans'

describe('PLANS', () => {
  it('tem preço positivo e o Pro custa mais que o Essencial', () => {
    expect(PLANS.essencial.precoCentavos).toBeGreaterThan(0)
    expect(PLANS.pro.precoCentavos).toBeGreaterThan(PLANS.essencial.precoCentavos)
  })

  it('descreve cada plano com features e um resumo para a landing', () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.features.length).toBeGreaterThan(0)
      expect(plan.resumo.length).toBeGreaterThan(0)
    }
    expect(PLANS.pro.destaque).toBe(true)
  })

  it('é puro: dá para importar sem tocar no banco', async () => {
    // A landing é rota pública e renderiza no navegador; se este módulo puxasse
    // db.server o build quebraria. O import acima já prova, o teste documenta.
    const mod = await import('./plans')
    expect(Object.keys(mod.PLANS)).toEqual(['essencial', 'pro'])
  })

  it('mantém o trial em dias inteiros e positivos', () => {
    expect(TRIAL_DAYS).toBeGreaterThan(0)
    expect(Number.isInteger(TRIAL_DAYS)).toBe(true)
  })
})

describe('formatPlanPrice', () => {
  it('mostra preço cheio sem centavos quando o valor é redondo', () => {
    expect(formatPlanPrice(14900)).toBe('R$ 149')
    expect(formatPlanPrice(29900)).toBe('R$ 299')
  })

  it('mostra os centavos quando existem', () => {
    expect(formatPlanPrice(14950)).toBe('R$ 149,50')
  })

  it('usa separador de milhar do pt-BR', () => {
    expect(formatPlanPrice(150000)).toBe('R$ 1.500')
  })
})
