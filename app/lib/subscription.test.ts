import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import {
  getSubscriptionStatus,
  isSubscriptionActive,
  PLANS,
  startTrial,
} from './subscription.server'

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

  it('cada plano tem features e a flag de destaque', () => {
    expect(PLANS.essencial.features.length).toBeGreaterThan(0)
    expect(PLANS.pro.destaque).toBe(true)
  })
})

describe('getSubscriptionStatus (tela de billing)', () => {
  it('sem assinatura → status none, não ativo', async () => {
    const t = await makeTenant()
    const v = await getSubscriptionStatus(t.id)
    expect(v.status).toBe('none')
    expect(v.active).toBe(false)
    expect(v.planName).toBeNull()
  })

  it('trial → trialing, ativo, com plano e dias restantes', async () => {
    const t = await makeTenant()
    await startTrial(t.id, 'essencial', 14)
    const v = await getSubscriptionStatus(t.id)
    expect(v.status).toBe('trialing')
    expect(v.active).toBe(true)
    expect(v.planName).toBe('Essencial')
    expect(v.daysLeft).toBeGreaterThan(0)
    expect(v.daysLeft).toBeLessThanOrEqual(14)
  })

  it('trial expirado → não ativo, daysLeft 0', async () => {
    const t = await makeTenant()
    await startTrial(t.id, 'essencial', 14)
    const futuro = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    const v = await getSubscriptionStatus(t.id, futuro)
    expect(v.active).toBe(false)
    expect(v.daysLeft).toBe(0)
  })
})
