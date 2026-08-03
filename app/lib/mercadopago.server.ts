// Cliente do Mercado Pago (marco M3) para ASSINATURA recorrente (preapproval). Fala com a API
// via fetch — sem lib nova na stack. Sem MP_ACCESS_TOKEN no ambiente, cai em modo stub (não cria
// nada, não move dinheiro): seguro pra dev e pra rodar antes de plugar a conta. Server-side.

import { createHmac, timingSafeEqual } from 'node:crypto'

const MP_API = 'https://api.mercadopago.com'

export type PreapprovalInput = {
  reason: string // aparece pro cliente (ex.: "Hermes — plano Essencial")
  amount: number // valor mensal em reais
  payerEmail: string
  backUrl: string // pra onde o MP volta após o checkout
  externalReference: string // nosso tenantId (liga o pagamento à empresa)
}

export type PreapprovalResult = { id: string; initPoint: string; status: string }

/** Cria uma assinatura mensal (preapproval) no MP. Retorna o id + a URL de checkout, ou null (stub/erro). */
export async function createPreapproval(
  input: PreapprovalInput,
): Promise<PreapprovalResult | null> {
  const token = process.env.MP_ACCESS_TOKEN
  if (!token) {
    console.warn(
      `[mp] MP_ACCESS_TOKEN ausente — assinatura de "${input.payerEmail}" NÃO criada (stub)`,
    )
    return null
  }
  try {
    const res = await fetch(`${MP_API}/preapproval`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: input.reason,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: input.amount,
          currency_id: 'BRL',
        },
        back_url: input.backUrl,
        payer_email: input.payerEmail,
        external_reference: input.externalReference,
        status: 'pending',
      }),
    })
    if (!res.ok) {
      console.error(
        `[mp] falha ao criar preapproval: ${res.status} ${await res.text().catch(() => '')}`,
      )
      return null
    }
    const data = (await res.json()) as { id: string; init_point: string; status: string }
    return { id: data.id, initPoint: data.init_point, status: data.status }
  } catch (error) {
    console.error('[mp] erro de rede ao criar preapproval', error)
    return null
  }
}

export type PreapprovalStatus = {
  id: string
  status: string
  externalReference: string | null
  nextPaymentDate: string | null
}

/** Lê o estado atual de um preapproval (o webhook manda só o id; buscamos a fonte da verdade). */
export async function getPreapproval(id: string): Promise<PreapprovalStatus | null> {
  const token = process.env.MP_ACCESS_TOKEN
  if (!token) {
    return null
  }
  try {
    const res = await fetch(`${MP_API}/preapproval/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      return null
    }
    const data = (await res.json()) as {
      id: string
      status: string
      external_reference?: string
      next_payment_date?: string | null
    }
    return {
      id: data.id,
      status: data.status,
      externalReference: data.external_reference ?? null,
      nextPaymentDate: data.next_payment_date ?? null,
    }
  } catch {
    return null
  }
}

export type MpAccount = {
  id: number
  nickname: string | null
  siteId: string | null // MLB = Brasil
  email: string | null
}

/**
 * Valida o `MP_ACCESS_TOKEN` chamando `/users/me` (read-only — não cria nada, não move
 * dinheiro). Retorna os dados da conta conectada, ou null (sem token / inválido / rede).
 * Serve pra provar que a conta está plugada antes de abrir cobrança. Server-side.
 */
export async function getMpAccount(): Promise<MpAccount | null> {
  const token = process.env.MP_ACCESS_TOKEN
  if (!token) {
    return null
  }
  try {
    const res = await fetch(`${MP_API}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      return null
    }
    const data = (await res.json()) as {
      id: number
      nickname?: string
      site_id?: string
      email?: string
    }
    return {
      id: data.id,
      nickname: data.nickname ?? null,
      siteId: data.site_id ?? null,
      email: data.email ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Valida a assinatura `x-signature` do webhook do Mercado Pago (issue #6 da auditoria).
 * O MP manda `x-signature: ts=<ts>,v1=<hmac>` + `x-request-id`; o HMAC-SHA256 é sobre o
 * manifesto documentado `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com o
 * MP_WEBHOOK_SECRET (chave de assinatura do painel do MP). FAIL-CLOSED: sem segredo
 * configurado, nada é confiável. Puro/testável. (data.id alfanumérico vai minúsculo,
 * conforme a doc do MP.) NOTA: o formato do manifesto deve ser conferido contra uma
 * notificação REAL do MP antes de depender em produção.
 */
export function verifyMpWebhookSignature(input: {
  dataId: string | null
  xSignature: string | null
  xRequestId: string | null
  secret: string | undefined
}): boolean {
  const { dataId, xSignature, xRequestId, secret } = input
  if (!secret || !xSignature || !dataId) {
    return false
  }
  const parts: Record<string, string> = {}
  for (const kv of xSignature.split(',')) {
    const idx = kv.indexOf('=')
    if (idx > 0) {
      parts[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim()
    }
  }
  const { ts, v1 } = parts
  if (!ts || !v1) {
    return false
  }
  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId ?? ''};ts:${ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(v1, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Traduz o status do Mercado Pago pro status interno da Subscription. */
export function mapMpStatus(mpStatus: string): 'active' | 'past_due' | 'canceled' | 'trialing' {
  switch (mpStatus) {
    case 'authorized':
      return 'active'
    case 'paused':
      return 'past_due'
    case 'cancelled':
      return 'canceled'
    default:
      return 'trialing' // pending e afins: ainda não pagou
  }
}
