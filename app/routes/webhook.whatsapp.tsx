import { reportDegradation } from '../lib/alarm.server'
import { processIncomingMessage } from '../lib/conversation.server'
import { checkRate, type RateState, rateConfig } from '../lib/rate-limit'
import {
  type InboundMessage,
  parseInboundMessages,
  resolveTenantSlugByPhoneNumber,
  sendWhatsAppMessage,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from '../lib/whatsapp.server'
import type { Route } from './+types/webhook.whatsapp'

// Teto global do webhook público (o app vê tudo como localhost atrás da ponte, então
// não dá pra limitar por IP). Estado no processo — zera a cada reinício do serviço.
let rateState: RateState = { windowStart: 0, count: 0 }

// GET — handshake de verificação: a Meta chama a URL com o verify_token; devolvemos
// o challenge só se bater. É como a Meta confirma que a URL é nossa.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const challenge = verifyWebhookChallenge(url.searchParams)
  if (challenge) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new Response('Forbidden', { status: 403 })
}

// Processa as mensagens recebidas: resolve a empresa pelo número, chama o MESMO
// motor do simulador e responde pela Cloud API. Roda em background (ver action).
async function handleInbound(messages: InboundMessage[]): Promise<void> {
  for (const message of messages) {
    // O resolve do tenant fica DENTRO do try: ele consulta o banco (pode falhar) e
    // handleInbound roda como fire-and-forget (`void`), então uma exceção aqui viraria
    // unhandled rejection e a mensagem se perderia sem log. Fail-safe: loga e segue.
    try {
      const tenantSlug = await resolveTenantSlugByPhoneNumber(message.phoneNumberId)
      if (!tenantSlug) {
        console.warn('[whatsapp] número sem empresa mapeada:', message.phoneNumberId)
        continue
      }
      // contactId = telefone validado do canal (wa_id), NUNCA do form — fecha o item
      // de identity spoofing do SECURITY-BACKLOG.
      const result = await processIncomingMessage({
        tenantSlug,
        message: message.text,
        contactId: message.from,
      })
      // Só responde se o Hermes gerou texto (em atendimento humano ele fica em silêncio).
      if (result.reply.trim().length > 0) {
        const sent = await sendWhatsAppMessage(message.from, result.reply, message.phoneNumberId)
        // Falha de envio não pode ser silenciosa: a resposta existe mas o cliente
        // ficou sem ela — alarma o operador (best-effort, com o throttle do alarme).
        if (!sent) {
          void reportDegradation('envio_whatsapp_falhou')
        }
      }
    } catch (error) {
      console.error(
        '[whatsapp] erro ao processar mensagem:',
        error instanceof Error ? error.message : error,
      )
    }
  }
}

// POST — mensagens recebidas. Valida a assinatura, então processa em BACKGROUND e
// devolve 200 imediatamente: a Meta tem timeout curto e a IA pode levar ~15s; sem
// isto a Meta reenviaria o evento. (Produção: trocar o fire-and-forget por uma fila.)
export async function action({ request }: Route.ActionArgs) {
  // Anti-flood: rejeita o excesso ANTES de ler o corpo ou validar assinatura (barato).
  const { max, windowMs } = rateConfig()
  const rate = checkRate(Date.now(), rateState, max, windowMs)
  rateState = rate.state
  if (!rate.allowed) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': String(rate.retryAfterSec) },
    })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyWebhookSignature(rawBody, signature)) {
    return new Response('Invalid signature', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad payload', { status: 400 })
  }

  void handleInbound(parseInboundMessages(payload))
  return new Response('EVENT_RECEIVED', { status: 200 })
}
