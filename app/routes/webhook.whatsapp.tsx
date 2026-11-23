import { checkRate, type RateState, rateConfig } from '../lib/rate-limit'
import {
  parseInboundMessages,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from '../lib/whatsapp.server'
import { drainPending, persistInbound } from '../lib/whatsapp-queue.server'
import type { Route } from './+types/webhook.whatsapp'

// Teto global (só pedidos VÁLIDOS) do webhook público (o app vê tudo como localhost atrás da ponte, então
// não dá pra limitar por IP). Estado no processo — zera a cada reinício do serviço.
let rateState: RateState = { windowStart: 0, count: 0 }

// Limite de corpo: a Meta manda payloads pequenos; 1 MB sobra.
const MAX_BODY_BYTES = 1024 * 1024

// Lê o corpo contando bytes; passou do teto, cancela e devolve null (sem Content-Length confiável).
async function readBodyLimited(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) {
    return ''
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

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

// POST — mensagens recebidas. Valida a assinatura, PERSISTE os eventos (dedup por
// wamid) e só então devolve 200: a Meta tem timeout curto e a IA pode levar ~20s.
// O processamento sai da fila (drainPending) — restart não perde mensagem e
// redelivery não gera resposta dupla.
export async function action({ request }: Route.ActionArgs) {
  // M2: corpo grande demais é recusado (413) ANTES de ler tudo e de calcular o HMAC.
  const declarado = Number(request.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > MAX_BODY_BYTES) {
    return new Response('Payload Too Large', { status: 413 })
  }
  const rawBody = await readBodyLimited(request, MAX_BODY_BYTES)
  if (rawBody === null) {
    return new Response('Payload Too Large', { status: 413 })
  }

  // M3: pedido inválido (sem assinatura ou errada) é 403 e NÃO gasta a cota global.
  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyWebhookSignature(rawBody, signature)) {
    return new Response('Forbidden', { status: 403 })
  }

  // Anti-flood só para pedidos válidos (assinados pela Meta).
  const { max, windowMs } = rateConfig()
  const rate = checkRate(Date.now(), rateState, max, windowMs)
  rateState = rate.state
  if (!rate.allowed) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': String(rate.retryAfterSec) },
    })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad payload', { status: 400 })
  }

  // Persistir ANTES do 200: se falhar (ex.: banco fora), a Meta recebe 500 e
  // REENVIA depois — melhor um retry da Meta do que uma mensagem perdida.
  await persistInbound(parseInboundMessages(payload))
  void drainPending()
  return new Response('EVENT_RECEIVED', { status: 200 })
}
