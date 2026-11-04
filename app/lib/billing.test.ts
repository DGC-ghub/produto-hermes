import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'

// Mocka o cliente do Mercado Pago — não toca a API real. mapMpStatus fica com a lógica real.
vi.mock('./mercadopago.server', () => ({
  createPreapproval: vi.fn(),
  getPreapproval: vi.fn(),
  mapMpStatus: (s: string) =>
    s === 'authorized' ? 'active' : s === 'cancelled' ? 'canceled' : 'trialing',
}))

import { startSubscription, syncSubscriptionFromMp } from './billing.server'
import { createPreapproval, getPreapproval } from './mercadopago.server'

const SLUG = 'zzz-m32-billing'

function makeTenant() {
  return db.tenant.create({ data: { slug: SLUG, name: 'M32 Billing' } })
}

afterEach(async () => {
  vi.clearAllMocks()
  const t = await db.tenant.findUnique({ where: { slug: SLUG } })
  if (t) {
    await db.subscription.deleteMany({ where: { tenantId: t.id } })
    await db.tenant.delete({ where: { id: t.id } })
  }
})

describe('startSubscription (M3)', () => {
  it('cria preapproval, guarda providerSubId + status e devolve o checkout', async () => {
    const t = await makeTenant()
    vi.mocked(createPreapproval).mockResolvedValue({
      id: 'pa_123',
      initPoint: 'https://mp/checkout',
      status: 'pending',
    })

    const url = await startSubscription({
      tenantId: t.id,
      planId: 'essencial',
      payerEmail: 'a@b.local',
      backUrl: 'https://x',
    })
    expect(url).toBe('https://mp/checkout')

    const sub = await db.subscription.findUnique({ where: { tenantId: t.id } })
    expect(sub?.provider).toBe('mercadopago')
    expect(sub?.providerSubId).toBe('pa_123')
    expect(sub?.status).toBe('trialing') // pending → trialing
  })

  it('sem MP configurado (createPreapproval null) → null e não cria sub', async () => {
    const t = await makeTenant()
    vi.mocked(createPreapproval).mockResolvedValue(null)
    const url = await startSubscription({
      tenantId: t.id,
      planId: 'essencial',
      payerEmail: 'a@b.local',
      backUrl: 'x',
    })
    expect(url).toBeNull()
    expect(await db.subscription.findUnique({ where: { tenantId: t.id } })).toBeNull()
  })
})

describe('syncSubscriptionFromMp (M3)', () => {
  it('atualiza o status a partir do estado real no MP (authorized → active)', async () => {
    const t = await makeTenant()
    await db.subscription.create({
      data: {
        tenantId: t.id,
        provider: 'mercadopago',
        providerSubId: 'pa_999',
        status: 'trialing',
      },
    })
    const nextPaymentDate = '2026-09-03T20:00:00.000-03:00'
    vi.mocked(getPreapproval).mockResolvedValue({
      id: 'pa_999',
      status: 'authorized',
      externalReference: t.id,
      nextPaymentDate,
    })

    expect(await syncSubscriptionFromMp('pa_999')).toBe(true)
    const sub = await db.subscription.findUnique({ where: { providerSubId: 'pa_999' } })
    expect(sub?.status).toBe('active')
    expect(sub?.currentPeriodEnd?.toISOString()).toBe(new Date(nextPaymentDate).toISOString())
  })

  it('preserva o período conhecido quando o MP omite ou devolve data inválida', async () => {
    const t = await makeTenant()
    const existingPeriodEnd = new Date('2026-09-15T12:00:00.000Z')
    await db.subscription.create({
      data: {
        tenantId: t.id,
        provider: 'mercadopago',
        providerSubId: 'pa_invalid_date',
        status: 'trialing',
        currentPeriodEnd: existingPeriodEnd,
      },
    })
    vi.mocked(getPreapproval).mockResolvedValue({
      id: 'pa_invalid_date',
      status: 'authorized',
      externalReference: t.id,
      nextPaymentDate: 'data-invalida',
    })

    expect(await syncSubscriptionFromMp('pa_invalid_date')).toBe(true)
    const sub = await db.subscription.findUnique({
      where: { providerSubId: 'pa_invalid_date' },
    })
    expect(sub?.status).toBe('active')
    expect(sub?.currentPeriodEnd?.toISOString()).toBe(existingPeriodEnd.toISOString())
  })

  it('preapproval que não conhecemos → false', async () => {
    vi.mocked(getPreapproval).mockResolvedValue({
      id: 'pa_x',
      status: 'authorized',
      externalReference: null,
      nextPaymentDate: null,
    })
    expect(await syncSubscriptionFromMp('pa_x')).toBe(false)
  })
})
