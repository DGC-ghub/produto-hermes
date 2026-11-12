import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Testes de ROTA do webhook do Mercado Pago. Sem chamada real ao MP: o sync é mockado e só
// provamos que NADA dispara sem assinatura válida (issue #6) e que o id certo chega ao sync.
const sync = vi.hoisted(() => ({ fn: vi.fn(async () => true) }))
vi.mock('../lib/billing.server', () => ({ syncSubscriptionFromMp: sync.fn }))

const SECRET = 'segredo-mp-teste'
const ID = 'PREAPPROVAL-TESTE-1'

function assinar(dataId: string, requestId = 'req-1', ts = '1700000000', secret = SECRET) {
  const v1 = createHmac('sha256', secret)
    .update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`)
    .digest('hex')
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId }
}

async function post(qs: string, headers: Record<string, string> = {}) {
  const { action } = await import('./webhook.mercadopago')
  return await action({
    request: new Request(`http://localhost/webhook/mercadopago?${qs}`, { method: 'POST', headers }),
    params: {},
    context: {},
  } as never)
}

beforeEach(() => {
  vi.stubEnv('MP_WEBHOOK_SECRET', SECRET)
  vi.stubEnv('RATE_LIMIT_MAX', '1000')
  sync.fn.mockClear()
})

describe('webhook Mercado Pago', () => {
  it('assinatura válida: 200 e sincroniza o preapproval informado', async () => {
    const res = await post(`data.id=${ID}`, assinar(ID))
    expect(res.status).toBe(200)
    expect(sync.fn).toHaveBeenCalledWith(ID)
  })

  it('sem assinatura: 401 e nenhuma chamada de saída', async () => {
    const res = await post(`data.id=${ID}`)
    expect(res.status).toBe(401)
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('assinatura feita com outro segredo: 401', async () => {
    const res = await post(`data.id=${ID}`, assinar(ID, 'req-1', '1700000000', 'outro'))
    expect(res.status).toBe(401)
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('assinatura de um id usada em outro id: 401 (não reaproveita)', async () => {
    const res = await post('data.id=OUTRO-ID', assinar(ID))
    expect(res.status).toBe(401)
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('sem MP_WEBHOOK_SECRET: 401 (fail-closed)', async () => {
    vi.stubEnv('MP_WEBHOOK_SECRET', '')
    const res = await post(`data.id=${ID}`, assinar(ID))
    expect(res.status).toBe(401)
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('sem data.id: 401 mesmo com cabeçalho', async () => {
    const res = await post('', assinar(ID))
    expect(res.status).toBe(401)
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('GET anônimo não dispara sync', async () => {
    const { loader } = await import('./webhook.mercadopago')
    const res = await loader()
    expect(res.status).toBe(200)
    expect(sync.fn).not.toHaveBeenCalled()
  })

  it('excesso de requisições: 429', async () => {
    vi.resetModules()
    vi.stubEnv('RATE_LIMIT_MAX', '1')
    await post(`data.id=${ID}`, assinar(ID))
    const res = await post(`data.id=${ID}`, assinar(ID))
    expect(res.status).toBe(429)
  })
})
