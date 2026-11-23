// Os 4 casos do webhook público (DGC-423): GET com token certo/errado e POST com assinatura
// certa/ausente/errada. Chama loader/action direto, sem servidor. A persistência é trocada
// por espiões: aqui importa provar que sem assinatura válida NADA chega à fila.

import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const persistInbound = vi.fn().mockResolvedValue(undefined)
const drainPending = vi.fn().mockResolvedValue(undefined)
vi.mock('../lib/whatsapp-queue.server', () => ({ persistInbound, drainPending }))

const ORIGINAL = { ...process.env }
const SECRET = 'app-secret-de-teste'
const BODY = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
const assinar = (corpo: string, segredo = SECRET) =>
  `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`

function post(headers: Record<string, string> = {}) {
  return new Request('https://x.test/webhook/whatsapp', { method: 'POST', body: BODY, headers })
}

beforeEach(() => {
  process.env.WHATSAPP_APP_SECRET = SECRET
  process.env.WHATSAPP_VERIFY_TOKEN = 'token-certo'
  persistInbound.mockClear()
})
afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('webhook WhatsApp', () => {
  it('GET com verify_token certo devolve o challenge', async () => {
    const { loader } = await import('./webhook.whatsapp')
    const url =
      'https://x.test/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=token-certo&hub.challenge=42'
    const r = await loader({ request: new Request(url) } as never)
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('42')
  })

  it('GET com verify_token errado recebe 403', async () => {
    const { loader } = await import('./webhook.whatsapp')
    const url =
      'https://x.test/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=42'
    const r = await loader({ request: new Request(url) } as never)
    expect(r.status).toBe(403)
  })

  it('POST com assinatura certa é aceito e persistido', async () => {
    const { action } = await import('./webhook.whatsapp')
    const r = await action({
      request: post({ 'x-hub-signature-256': assinar(BODY) }),
    } as never)
    expect(r.status).toBe(200)
    expect(persistInbound).toHaveBeenCalledTimes(1)
  })

  it('POST sem assinatura recebe 403 e nada é persistido', async () => {
    const { action } = await import('./webhook.whatsapp')
    const r = await action({ request: post() } as never)
    expect(r.status).toBe(403)
    expect(persistInbound).not.toHaveBeenCalled()
  })

  it('POST com assinatura errada recebe 403 e nada é persistido', async () => {
    const { action } = await import('./webhook.whatsapp')
    const r = await action({
      request: post({ 'x-hub-signature-256': assinar(BODY, 'outro-segredo') }),
    } as never)
    expect(r.status).toBe(403)
    expect(persistInbound).not.toHaveBeenCalled()
  })
})
