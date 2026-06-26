import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type InboundMessage,
  parseInboundMessages,
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
