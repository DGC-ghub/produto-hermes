import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { checkBillingGate } from './billing-gate.server'
import { startTrial } from './subscription.server'

const SLUG = 'zzz-test-billing-gate'
const ORIGINAL = { ...process.env }

async function makeTenant() {
  return db.tenant.create({ data: { slug: SLUG, name: 'Gate' } })
}

const EXPIRADO = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 dias à frente do trial

beforeEach(() => {
  process.env = { ...ORIGINAL }
})
afterEach(async () => {
  // Restaura o env DEPOIS de cada teste também — senão o último teste (que liga o flag)
  // vaza BILLING_GATE_ENABLED pro próximo arquivo no mesmo worker (fonte de flaky).
  process.env = { ...ORIGINAL }
  const tenant = await db.tenant.findUnique({ where: { slug: SLUG } })
  if (tenant) {
    await db.subscription.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.delete({ where: { id: tenant.id } })
  }
})

describe('checkBillingGate (Tier 2)', () => {
  it('SEM assinatura → permitido (grandfathering de pilotos/legado)', async () => {
    const t = await makeTenant()
    const g = await checkBillingGate(t.id)
    expect(g.allowed).toBe(true)
    expect(g.reason).toBe('no_subscription')
  })

  it('assinatura ATIVA (trial) → permitido', async () => {
    const t = await makeTenant()
    await startTrial(t.id, 'essencial', 14)
    const g = await checkBillingGate(t.id)
    expect(g.allowed).toBe(true)
    expect(g.reason).toBe('active')
  })

  it('assinatura INATIVA + flag DESLIGADO → permitido (não para nada)', async () => {
    const t = await makeTenant()
    await startTrial(t.id, 'essencial', 14)
    process.env.BILLING_GATE_ENABLED = ''
    const g = await checkBillingGate(t.id, EXPIRADO())
    expect(g.allowed).toBe(true)
    expect(g.reason).toBe('gate_disabled')
  })

  it('assinatura INATIVA + flag LIGADO → BLOQUEADO', async () => {
    const t = await makeTenant()
    await startTrial(t.id, 'essencial', 14)
    process.env.BILLING_GATE_ENABLED = '1'
    const g = await checkBillingGate(t.id, EXPIRADO())
    expect(g.allowed).toBe(false)
    expect(g.reason).toBe('inactive')
  })

  it('flag LIGADO mas SEM assinatura → ainda permitido (grandfathering vence o flag)', async () => {
    const t = await makeTenant()
    process.env.BILLING_GATE_ENABLED = '1'
    const g = await checkBillingGate(t.id)
    expect(g.allowed).toBe(true)
    expect(g.reason).toBe('no_subscription')
  })
})
