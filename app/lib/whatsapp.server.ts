import { createHmac, timingSafeEqual } from 'node:crypto'

// Integração com o WhatsApp Business Platform (Meta Cloud API). O webhook reutiliza
// `processIncomingMessage` — aqui ficam só as peças do canal: handshake, validação
// de assinatura, parsing do payload, envio e resolução de empresa pelo número.
// Segredos vêm SEMPRE do ambiente (nunca no código). Ver docs/whatsapp-oficial-notas.md.

const GRAPH_VERSION = 'v21.0'

// --- Helpers de navegação segura em JSON externo (sem `any`) ---
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Handshake de verificação do webhook (GET). A Meta chama com hub.mode/verify_token/
 * challenge; devolvemos o challenge só se o verify_token bater com o nosso. Pura.
 */
export function verifyWebhookChallenge(params: URLSearchParams): string | null {
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')
  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return challenge
  }
  return null
}

/**
 * Valida a assinatura do webhook (POST) — `X-Hub-Signature-256` é o HMAC-SHA256 do
 * corpo cru com o App Secret. Fail-closed: sem App Secret ou assinatura, recusa.
 * Comparação em tempo constante. Server-side (usa env).
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (!appSecret || !signatureHeader?.startsWith('sha256=')) {
    return false
  }
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signatureHeader.slice('sha256='.length), 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export type InboundMessage = {
  from: string // wa_id do cliente (telefone validado) -> contactId
  text: string // corpo da mensagem de texto
  phoneNumberId: string // número da EMPRESA que recebeu -> resolve o tenant
  messageId: string
}

/**
 * Extrai as mensagens de TEXTO de um payload de webhook da Meta. Ignora o que não
 * for texto (status, mídia etc.). Função pura e defensiva — entrada é JSON externo.
 */
export function parseInboundMessages(payload: unknown): InboundMessage[] {
  const result: InboundMessage[] = []
  const root = asRecord(payload)
  for (const entry of asArray(root?.entry)) {
    for (const change of asArray(asRecord(entry)?.changes)) {
      const value = asRecord(asRecord(change)?.value)
      const phoneNumberId = asString(asRecord(value?.metadata)?.phone_number_id)
      if (!phoneNumberId) {
        continue
      }
      for (const rawMsg of asArray(value?.messages)) {
        const msg = asRecord(rawMsg)
        const from = asString(msg?.from)
        const text = asString(asRecord(msg?.text)?.body)
        if (msg?.type === 'text' && from && text) {
          result.push({ from, text, phoneNumberId, messageId: asString(msg?.id) ?? '' })
        }
      }
    }
  }
  return result
}

/**
 * Resolve o slug do tenant a partir do número da empresa (phone_number_id). Mapa no
 * ambiente: `WHATSAPP_NUMBER_MAP="phoneId:slug,phoneId2:slug2"`. MVP: um número por
 * empresa; vira config por tenant quando houver vários. Pura quanto ao argumento.
 */
export function resolveTenantSlugByPhoneNumberId(phoneNumberId: string): string | null {
  const map = process.env.WHATSAPP_NUMBER_MAP ?? ''
  for (const pair of map.split(',')) {
    const [id, slug] = pair.split(':').map((part) => part.trim())
    if (id && id === phoneNumberId && slug) {
      return slug
    }
  }
  return null
}

/**
 * Envia uma mensagem de texto pela Cloud API. Best-effort: sem credenciais ou em
 * erro, loga e devolve false (o webhook nunca quebra por causa do envio). Server-side.
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string,
  phoneNumberId?: string,
): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const numberId = phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !numberId) {
    console.warn('[whatsapp] envio ignorado — WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID ausentes')
    return false
  }
  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${numberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      },
    )
    if (!response.ok) {
      const errorBody = await response.text()
      console.error(`[whatsapp] envio falhou: HTTP ${response.status} — ${errorBody}`)
      return false
    }
    return true
  } catch (error) {
    console.error('[whatsapp] erro no envio:', error instanceof Error ? error.message : error)
    return false
  }
}
