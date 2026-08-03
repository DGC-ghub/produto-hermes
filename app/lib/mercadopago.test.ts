import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPreapproval,
  getMpAccount,
  getPreapproval,
  mapMpStatus,
  verifyMpWebhookSignature,
} from './mercadopago.server'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

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

describe('getPreapproval — contrato da API', () => {
  it('mapeia next_payment_date como próxima renovação', async () => {
    vi.stubEnv('MP_ACCESS_TOKEN', 'token-de-teste')
    const nextPaymentDate = '2026-09-03T20:00:00.000-03:00'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'pa_123',
            status: 'authorized',
            external_reference: 'tenant-1',
            next_payment_date: nextPaymentDate,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    await expect(getPreapproval('pa_123')).resolves.toEqual({
      id: 'pa_123',
      status: 'authorized',
      externalReference: 'tenant-1',
      nextPaymentDate,
    })
  })
})

describe('verifyMpWebhookSignature (#6 — webhook fail-closed)', () => {
  const secret = 'sk-test-webhook'
  const dataId = 'ABC123'
  const xRequestId = 'req-1'
  const ts = '1700000000'
  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex')
  const xSignature = `ts=${ts},v1=${v1}`

  it('aceita assinatura válida', () => {
    expect(verifyMpWebhookSignature({ dataId, xSignature, xRequestId, secret })).toBe(true)
  })
  it('rejeita assinatura adulterada', () => {
    const bad = `ts=${ts},v1=${'0'.repeat(64)}`
    expect(verifyMpWebhookSignature({ dataId, xSignature: bad, xRequestId, secret })).toBe(false)
  })
  it('FAIL-CLOSED: rejeita quando o segredo não está configurado', () => {
    expect(verifyMpWebhookSignature({ dataId, xSignature, xRequestId, secret: undefined })).toBe(
      false,
    )
  })
  it('rejeita sem x-signature ou sem data.id', () => {
    expect(verifyMpWebhookSignature({ dataId, xSignature: null, xRequestId, secret })).toBe(false)
    expect(verifyMpWebhookSignature({ dataId: null, xSignature, xRequestId, secret })).toBe(false)
  })
})
