import { createHmac } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { ensureTenant } from './tenants.server'
import {
  type InboundMessage,
  parseInboundMessages,
  registerWhatsappNumber,
  resolveTenantSlugByPhoneNumber,
  resolveTenantSlugByPhoneNumberId,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from './whatsapp.server'

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('verifyWebhookChallenge', () => {
  it('devolve o challenge quando o verify_token bate', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'segredo-verify'
    const params = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'segredo-verify',
      'hub.challenge': '12345',
    })
    expect(verifyWebhookChallenge(params)).toBe('12345')
  })

  it('recusa quando o token não bate ou falta', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'segredo-verify'
    expect(
      verifyWebhookChallenge(
        new URLSearchParams({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'errado',
          'hub.challenge': 'x',
        }),
      ),
    ).toBeNull()
    process.env.WHATSAPP_VERIFY_TOKEN = ''
    expect(
      verifyWebhookChallenge(
        new URLSearchParams({
          'hub.mode': 'subscribe',
          'hub.verify_token': '',
          'hub.challenge': 'x',
        }),
      ),
    ).toBeNull()
  })
})

describe('verifyWebhookSignature', () => {
  const secret = 'test-app-secret'
  const body = JSON.stringify({ entry: [] })

  it('aceita a assinatura HMAC correta', () => {
    process.env.WHATSAPP_APP_SECRET = secret
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    expect(verifyWebhookSignature(body, sig)).toBe(true)
  })

  it('rejeita assinatura errada, ausente ou malformada', () => {
    process.env.WHATSAPP_APP_SECRET = secret
    expect(verifyWebhookSignature(body, 'sha256=00')).toBe(false)
    expect(verifyWebhookSignature(body, null)).toBe(false)
    expect(verifyWebhookSignature(body, 'semprefixo')).toBe(false)
  })

  it('é fail-closed quando o App Secret não está configurado', () => {
    process.env.WHATSAPP_APP_SECRET = ''
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    expect(verifyWebhookSignature(body, sig)).toBe(false)
  })
})

describe('parseInboundMessages', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: 'PHONE_123' },
              messages: [
                {
                  from: '5511988887777',
                  id: 'wamid.AAA',
                  type: 'text',
                  text: { body: 'Minha geladeira parou' },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  }

  it('extrai a mensagem de texto com from, texto e phoneNumberId', () => {
    const result = parseInboundMessages(payload)
    expect(result).toHaveLength(1)
    const msg = result[0] as InboundMessage
    expect(msg.from).toBe('5511988887777')
    expect(msg.text).toBe('Minha geladeira parou')
    expect(msg.phoneNumberId).toBe('PHONE_123')
    expect(msg.messageId).toBe('wamid.AAA')
  })

  it('ignora mensagens que não são texto (status, mídia)', () => {
    const statusOnly = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'PHONE_123' },
                statuses: [{ status: 'delivered' }],
              },
            },
          ],
        },
      ],
    }
    expect(parseInboundMessages(statusOnly)).toHaveLength(0)
  })

  it('não quebra com payload malformado', () => {
    expect(parseInboundMessages(null)).toEqual([])
    expect(parseInboundMessages({})).toEqual([])
    expect(parseInboundMessages({ entry: 'nope' })).toEqual([])
  })

  function mediaPayload(type: string) {
    return {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'PHONE_123' },
                messages: [{ from: '5511988887777', id: 'wamid.MEDIA', type, [type]: {} }],
              },
            },
          ],
        },
      ],
    }
  }

  // Áudio era descartado em SILÊNCIO — o cliente recebia vácuo. Agora vira evento
  // 'unsupported' que ganha a resposta de cortesia na fila.
  it('extrai áudio/imagem/documento como unsupported (com dedup id)', () => {
    for (const type of ['audio', 'image', 'document']) {
      const result = parseInboundMessages(mediaPayload(type))
      expect(result).toHaveLength(1)
      expect(result[0].kind).toBe('unsupported')
      expect(result[0].mediaType).toBe(type)
      expect(result[0].messageId).toBe('wamid.MEDIA')
      expect(result[0].text).toBe('')
    }
  })

  it('mensagem de texto sai com kind=text', () => {
    expect(parseInboundMessages(payload)[0].kind).toBe('text')
  })

  it('reação continua ignorada (auto-responder um 👍 é pior que silêncio)', () => {
    expect(parseInboundMessages(mediaPayload('reaction'))).toHaveLength(0)
  })
})

describe('resolveTenantSlugByPhoneNumberId', () => {
  it('mapeia o número da empresa para o slug pelo env', () => {
    process.env.WHATSAPP_NUMBER_MAP = 'PHONE_123:assistencia-tecnica-demo, PHONE_999:dgc'
    expect(resolveTenantSlugByPhoneNumberId('PHONE_123')).toBe('assistencia-tecnica-demo')
    expect(resolveTenantSlugByPhoneNumberId('PHONE_999')).toBe('dgc')
  })

  it('devolve null para número desconhecido ou mapa vazio', () => {
    process.env.WHATSAPP_NUMBER_MAP = 'PHONE_123:dgc'
    expect(resolveTenantSlugByPhoneNumberId('OUTRO')).toBeNull()
    process.env.WHATSAPP_NUMBER_MAP = ''
    expect(resolveTenantSlugByPhoneNumberId('PHONE_123')).toBeNull()
  })
})

describe('resolveTenantSlugByPhoneNumber (banco + fallback env)', () => {
  const WA_TENANT = 'zzz-test-wa-tenant'
  const WA_PHONE = 'WA_TEST_DB_1'

  beforeAll(async () => {
    await ensureTenant({ slug: WA_TENANT, name: 'WA Test Tenant' })
  })
  afterEach(async () => {
    await db.whatsappNumber.deleteMany({ where: { phoneNumberId: { startsWith: 'WA_TEST_' } } })
  })
  afterAll(async () => {
    await db.whatsappNumber.deleteMany({ where: { tenant: { slug: WA_TENANT } } })
    await db.tenant.deleteMany({ where: { slug: WA_TENANT } })
  })

  it('resolve pelo banco quando há registro — e o banco vence o env', async () => {
    await registerWhatsappNumber(WA_PHONE, WA_TENANT, 'Número principal')
    // Mesmo com o env apontando para outro slug, a fonte de verdade é o banco.
    process.env.WHATSAPP_NUMBER_MAP = `${WA_PHONE}:dgc`
    expect(await resolveTenantSlugByPhoneNumber(WA_PHONE)).toBe(WA_TENANT)
  })

  it('cai no fallback do env quando não há registro no banco', async () => {
    process.env.WHATSAPP_NUMBER_MAP = 'WA_TEST_ENV:assistencia-tecnica-demo'
    expect(await resolveTenantSlugByPhoneNumber('WA_TEST_ENV')).toBe('assistencia-tecnica-demo')
  })

  it('devolve null quando não está no banco nem no env', async () => {
    process.env.WHATSAPP_NUMBER_MAP = ''
    expect(await resolveTenantSlugByPhoneNumber('WA_TEST_INEXISTENTE')).toBeNull()
  })
})

describe('registerWhatsappNumber', () => {
  const WA_A = 'zzz-test-wa-reg-a'
  const WA_B = 'zzz-test-wa-reg-b'

  beforeAll(async () => {
    await ensureTenant({ slug: WA_A, name: 'WA Reg A' })
    await ensureTenant({ slug: WA_B, name: 'WA Reg B' })
  })
  afterEach(async () => {
    await db.whatsappNumber.deleteMany({ where: { phoneNumberId: { startsWith: 'WA_REG_' } } })
  })
  afterAll(async () => {
    await db.whatsappNumber.deleteMany({ where: { tenant: { slug: { in: [WA_A, WA_B] } } } })
    await db.tenant.deleteMany({ where: { slug: { in: [WA_A, WA_B] } } })
  })

  it('rejeita tenant desconhecido', async () => {
    await expect(registerWhatsappNumber('WA_REG_X', 'slug-que-nao-existe')).rejects.toThrow(
      'Unknown tenant',
    )
  })

  it('é idempotente e reatribui o número a outra empresa (sem duplicar linha)', async () => {
    await registerWhatsappNumber('WA_REG_1', WA_A)
    await registerWhatsappNumber('WA_REG_1', WA_B) // reatribui o mesmo número
    process.env.WHATSAPP_NUMBER_MAP = ''
    expect(await resolveTenantSlugByPhoneNumber('WA_REG_1')).toBe(WA_B)
    const rows = await db.whatsappNumber.findMany({ where: { phoneNumberId: 'WA_REG_1' } })
    expect(rows.length).toBe(1)
  })
})
