import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { isSubscriptionActive, PLANS, startTrial } from './subscription.server'

const SLUG = 'zzz-m3-sub'

async function makeTenant() {
  return db.tenant.create({ data: { slug: SLUG, name: 'M3 Sub' } })
}

afterEach(async () => {
  const tenant = await db.tenant.findUnique({ where: { slug: SLUG } })
  if (tenant) {
    await db.subscription.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.delete({ where: { id: tenant.id } })
  }
})

describe('isSubscriptionActive (M3)', () => {
  it('sem assinatura → não ativo', async () => {
    const t = await makeTenant()
    expect(await isSubscriptionActive(t.id)).toBe(false)
  })

  it('trial com período no futuro → ativo', async () => {
    const t = await makeTenant()
    await startTrial(t.id, 'essencial', 14)
    expect(await isSubscriptionActive(t.id)).toBe(true)
  })

  it('período expirado → não ativo', async () => {
    const t = await makeTenant()
    await startTrial(t.id, 'essencial', 14)
    // avança o "agora" pra 15 dias depois
    const futuro = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    expect(await isSubscriptionActive(t.id, futuro)).toBe(false)
  })

  it('status canceled → não ativo mesmo com período futuro', async () => {
    const t = await makeTenant()
    await db.subscription.create({
      data: {
        tenantId: t.id,
        provider: 'stripe',
        status: 'canceled',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    expect(await isSubscriptionActive(t.id)).toBe(false)
  })

  it('status active sem período (nunca expira) → ativo', async () => {
    const t = await makeTenant()
    await db.subscription.create({ data: { tenantId: t.id, provider: 'manual', status: 'active' } })
    expect(await isSubscriptionActive(t.id)).toBe(true)
  })
})

describe('PLANS', () => {
  it('tem os planos com preço em centavos', () => {
    expect(PLANS.essencial.precoCentavos).toBeGreaterThan(0)
    expect(PLANS.pro.precoCentavos).toBeGreaterThan(PLANS.essencial.precoCentavos)
  })
})
