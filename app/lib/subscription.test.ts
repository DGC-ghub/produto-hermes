import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import {
  daysRemaining,
  getSubscriptionStatus,
  isSubscriptionActive,
  PLANS,
  type SubscriptionView,
  startTrial,
  subscriptionNotice,
  TRIAL_URGENT_DAYS,
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

describe('daysRemaining (contagem do aviso de teste)', () => {
  const now = new Date('2026-07-28T12:00:00Z')

  it('14 dias cheios → 14', () => {
    expect(daysRemaining(new Date('2026-08-11T12:00:00Z'), now)).toBe(14)
  })

  it('meio dia restante ainda conta como 1 dia', () => {
    expect(daysRemaining(new Date('2026-07-29T00:00:00Z'), now)).toBe(1)
  })

  it('um minuto restante ainda conta como 1 dia', () => {
    expect(daysRemaining(new Date('2026-07-28T12:01:00Z'), now)).toBe(1)
  })

  it('não depende do fuso: conta o instante, não o dia do calendário', () => {
    const fim = new Date('2026-07-29T02:00:00Z') // 28/07 às 23h em Brasília
    const agoraEmBrasilia = new Date('2026-07-28T22:00:00-03:00') // mesmo instante que 29/07 01:00Z
    // Os dois caem no dia 28 no calendário de Brasília; quem contasse dias de calendário
    // diria "0". Falta 1 hora, então ainda é 1 dia — e a resposta não muda com a notação.
    expect(daysRemaining(fim, agoraEmBrasilia)).toBe(1)
    expect(daysRemaining(fim, new Date('2026-07-29T01:00:00Z'))).toBe(1)
  })

  it('já passou → 0, nunca negativo', () => {
    expect(daysRemaining(new Date('2026-07-20T12:00:00Z'), now)).toBe(0)
    expect(daysRemaining(now, now)).toBe(0)
  })
})

describe('subscriptionNotice (faixa do painel)', () => {
  function view(over: Partial<SubscriptionView>): SubscriptionView {
    return {
      status: 'trialing',
      planId: 'essencial',
      planName: 'Essencial',
      currentPeriodEnd: null,
      daysLeft: 10,
      active: true,
      ...over,
    }
  }

  it('sem assinatura (piloto legado) → não avisa nada', () => {
    expect(subscriptionNotice(view({ status: 'none', active: false, daysLeft: null }))).toEqual({
      kind: 'none',
      daysLeft: null,
    })
  })

  it('teste com folga → aviso calmo com os dias', () => {
    expect(subscriptionNotice(view({ daysLeft: 10 }))).toEqual({ kind: 'trial', daysLeft: 10 })
  })

  it('teste acabando (no limite e abaixo dele) → aviso urgente', () => {
    expect(subscriptionNotice(view({ daysLeft: TRIAL_URGENT_DAYS })).kind).toBe('trial_ending')
    expect(subscriptionNotice(view({ daysLeft: 1 })).kind).toBe('trial_ending')
    expect(subscriptionNotice(view({ daysLeft: TRIAL_URGENT_DAYS + 1 })).kind).toBe('trial')
  })

  it('teste sem data de fim → avisa sem contagem, não inventa "0 dias"', () => {
    expect(subscriptionNotice(view({ daysLeft: null }))).toEqual({ kind: 'trial', daysLeft: null })
  })

  it('teste vencido → trial_over', () => {
    expect(subscriptionNotice(view({ active: false, daysLeft: 0 })).kind).toBe('trial_over')
  })

  it('pagante em dia → aviso discreto de assinatura ativa', () => {
    expect(subscriptionNotice(view({ status: 'active', daysLeft: 22 }))).toEqual({
      kind: 'active',
      daysLeft: 22,
    })
  })

  it('quem já pagou nunca lê "teste acabou" — cobrança recusada vira outro aviso', () => {
    expect(subscriptionNotice(view({ status: 'past_due', active: false })).kind).toBe(
      'payment_problem',
    )
  })

  it('quem cancelou de propósito não é acusado de falha de pagamento', () => {
    expect(subscriptionNotice(view({ status: 'canceled', active: false })).kind).toBe('canceled')
  })

  it('pagante com período vencido NÃO é acusado — a data que sobrou é a do trial', () => {
    // O webhook do Mercado Pago só grava `status`, nunca renova `currentPeriodEnd`
    // (billing.server.ts). Quem assinou no meio do teste fica, depois do 14º dia, com
    // status 'active' e período vencido. Chamar isso de "pagamento não confirmado" seria
    // caluniar um cliente em dia — o pior texto possível para quem acabou de pagar.
    expect(subscriptionNotice(view({ status: 'active', active: false, daysLeft: 0 })).kind).toBe(
      'active',
    )
  })
})
