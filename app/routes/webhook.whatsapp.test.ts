import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'

// Testes de ROTA do webhook do WhatsApp (Meta). Dados fictícios; a fila não processa (drainPending
// mockado): aqui provamos a porta de entrada — handshake, assinatura, payload, dedup, escopo por número.
const drain = vi.hoisted(() => ({ fn: vi.fn(async () => undefined) }))
vi.mock('../lib/whatsapp-queue.server', async (orig) => ({
  ...(await orig<typeof import('../lib/whatsapp-queue.server')>()),
  drainPending: drain.fn,
}))

const SECRET = 'segredo-de-teste-app'
const VERIFY = 'token-de-verificacao-teste'
const PHONE_A = 'test-wh-phone-A'
const PHONE_B = 'test-wh-phone-B'
const CONTACT = 'test-wh-5511900000001'
const URL_WH = 'http://localhost/webhook/whatsapp'

const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

function payload(phoneId: string, wamid: string, text = 'Oi, quero saber os preços') {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneId },
              messages: [{ from: CONTACT, id: wamid, type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  })
}

function post(body: string, headers: Record<string, string> = {}) {
  return new Request(URL_WH, { method: 'POST', body, headers })
}

async function rota() {
  return await import('./webhook.whatsapp')
}

async function callAction(request: Request) {
  const { action } = await rota()
  return await action({ request, params: {}, context: {} } as never)
}

beforeEach(() => {
  vi.stubEnv('WHATSAPP_APP_SECRET', SECRET)
  vi.stubEnv('WHATSAPP_VERIFY_TOKEN', VERIFY)
  vi.stubEnv('RATE_LIMIT_MAX', '1000')
  drain.fn.mockClear()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await db.webhookEvent.deleteMany({ where: { contactId: CONTACT } })
})

describe('webhook WhatsApp — GET (handshake)', () => {
  async function get(qs: string) {
    const { loader } = await rota()
    return await loader({
      request: new Request(`${URL_WH}?${qs}`),
      params: {},
      context: {},
    } as never)
  }

  it('devolve o challenge com o verify_token certo', async () => {
    const res = await get(`hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=abc123`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('abc123')
  })

  it('recusa (403) token errado', async () => {
    const res = await get('hub.mode=subscribe&hub.verify_token=errado&hub.challenge=abc123')
    expect(res.status).toBe(403)
  })

  it('recusa (403) quando o token não está configurado (fail-closed)', async () => {
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', '')
    const res = await get('hub.mode=subscribe&hub.verify_token=&hub.challenge=abc123')
    expect(res.status).toBe(403)
  })
})

describe('webhook WhatsApp — POST', () => {
  it('assinatura inválida: 401, nada gravado, nada processado', async () => {
    const body = payload(PHONE_A, 'wamid.test-wh-1')
    const res = await callAction(post(body, { 'x-hub-signature-256': sign(body, 'outro-segredo') }))
    expect(res.status).toBe(401)
    expect(await db.webhookEvent.count({ where: { contactId: CONTACT } })).toBe(0)
    expect(drain.fn).not.toHaveBeenCalled()
  })

  it('sem cabeçalho de assinatura: 401', async () => {
    const res = await callAction(post(payload(PHONE_A, 'wamid.test-wh-2')))
    expect(res.status).toBe(401)
    expect(await db.webhookEvent.count({ where: { contactId: CONTACT } })).toBe(0)
  })

  it('sem WHATSAPP_APP_SECRET: recusa mesmo com assinatura "correta" (fail-closed)', async () => {
    const body = payload(PHONE_A, 'wamid.test-wh-3')
    const assinatura = sign(body, '')
    vi.stubEnv('WHATSAPP_APP_SECRET', '')
    const res = await callAction(post(body, { 'x-hub-signature-256': assinatura }))
    expect(res.status).toBe(401)
    expect(await db.webhookEvent.count({ where: { contactId: CONTACT } })).toBe(0)
  })

  it('corpo alterado depois de assinado: 401', async () => {
    const body = payload(PHONE_A, 'wamid.test-wh-4')
    const res = await callAction(
      post(body.replace('preços', 'senhas'), { 'x-hub-signature-256': sign(body) }),
    )
    expect(res.status).toBe(401)
  })

  it('assinatura válida mas JSON quebrado: 400', async () => {
    const body = '{nao e json'
    const res = await callAction(post(body, { 'x-hub-signature-256': sign(body) }))
    expect(res.status).toBe(400)
  })

  it('mensagem válida: 200, grava o evento com o número da empresa e dispara a fila', async () => {
    const body = payload(PHONE_A, 'wamid.test-wh-5')
    const res = await callAction(post(body, { 'x-hub-signature-256': sign(body) }))
    expect(res.status).toBe(200)
    const eventos = await db.webhookEvent.findMany({ where: { contactId: CONTACT } })
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ messageId: 'wamid.test-wh-5', phoneNumberId: PHONE_A })
    expect(drain.fn).toHaveBeenCalledTimes(1)
  })

  it('reenvio da Meta (mesmo wamid): 200 e UM só evento (sem resposta dupla)', async () => {
    const body = payload(PHONE_A, 'wamid.test-wh-6')
    const h = { 'x-hub-signature-256': sign(body) }
    expect((await callAction(post(body, h))).status).toBe(200)
    expect((await callAction(post(body, h))).status).toBe(200)
    expect(await db.webhookEvent.count({ where: { contactId: CONTACT } })).toBe(1)
  })

  it('mesmo contato falando com duas empresas: cada evento fica no número da sua empresa', async () => {
    const a = payload(PHONE_A, 'wamid.test-wh-7a')
    const b = payload(PHONE_B, 'wamid.test-wh-7b')
    await callAction(post(a, { 'x-hub-signature-256': sign(a) }))
    await callAction(post(b, { 'x-hub-signature-256': sign(b) }))
    const porNumero = Object.fromEntries(
      (await db.webhookEvent.findMany({ where: { contactId: CONTACT } })).map((e) => [
        e.messageId,
        e.phoneNumberId,
      ]),
    )
    expect(porNumero).toEqual({ 'wamid.test-wh-7a': PHONE_A, 'wamid.test-wh-7b': PHONE_B })
  })

  it('payload assinado sem mensagem de texto (ex.: status): 200 e nada gravado', async () => {
    const body = JSON.stringify({
      entry: [
        {
          changes: [{ value: { metadata: { phone_number_id: PHONE_A }, statuses: [{ id: 'x' }] } }],
        },
      ],
    })
    const res = await callAction(post(body, { 'x-hub-signature-256': sign(body) }))
    expect(res.status).toBe(200)
    expect(await db.webhookEvent.count({ where: { contactId: CONTACT } })).toBe(0)
  })

  it('excesso de requisições: 429 com Retry-After, antes de ler assinatura', async () => {
    vi.resetModules()
    vi.stubEnv('RATE_LIMIT_MAX', '2')
    const { action } = await import('./webhook.whatsapp')
    const body = payload(PHONE_A, 'wamid.test-wh-8')
    const h = { 'x-hub-signature-256': sign(body) }
    const run = () => action({ request: post(body, h), params: {}, context: {} } as never)
    await run()
    await run()
    const res = await run()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })
})
