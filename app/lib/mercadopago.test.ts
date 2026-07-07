import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreapproval, getMpAccount, getPreapproval, mapMpStatus } from './mercadopago.server'

afterEach(() => vi.unstubAllEnvs())

describe('mapMpStatus (M3)', () => {
  it('traduz os status do Mercado Pago pro interno', () => {
    expect(mapMpStatus('authorized')).toBe('active')
    expect(mapMpStatus('paused')).toBe('past_due')
    expect(mapMpStatus('cancelled')).toBe('canceled')
    expect(mapMpStatus('pending')).toBe('trialing')
    expect(mapMpStatus('qualquer-outro')).toBe('trialing')
  })
})

describe('cliente MP em modo stub (sem MP_ACCESS_TOKEN)', () => {
  it('createPreapproval → null (não cria, não move dinheiro)', async () => {
    vi.stubEnv('MP_ACCESS_TOKEN', '')
    const r = await createPreapproval({
      reason: 'Hermes Essencial',
      amount: 149,
      payerEmail: 'a@b.local',
      backUrl: 'https://x',
      externalReference: 't1',
    })
    expect(r).toBeNull()
  })

  it('getPreapproval → null', async () => {
    vi.stubEnv('MP_ACCESS_TOKEN', '')
    expect(await getPreapproval('abc')).toBeNull()
  })

  it('getMpAccount → null (não valida sem token)', async () => {
    vi.stubEnv('MP_ACCESS_TOKEN', '')
    expect(await getMpAccount()).toBeNull()
  })
})
