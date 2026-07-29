import { db } from '../db.server'
import { startEmailVerification } from './email-verification.server'
import { hashPassword } from './operators.server'
import { provisionTenant } from './provisioning.server'
import { checkRate, type RateState } from './rate-limit'
import { startTrial } from './subscription.server'

// Cadastro self-service (marco M2.6b): transforma nome+email+senha numa empresa provisionada
// com dono owner e um e-mail de confirmação a caminho. Lógica pura de orquestração (a rota
// /signup só chama isto e cria a sessão). Server-side.

/** Deriva um slug seguro (a-z0-9-) do nome da empresa. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tira acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export type RegisterInput = {
  companyName: string
  email: string
  password: string
  baseUrl: string
}

export type RegisterOk = {
  ok: true
  accountId: string
  tenantId: string
  slug: string
  email: string
  /** O e-mail de confirmação saiu mesmo? Se não, a tela precisa contar a verdade e oferecer reenvio. */
  emailSent: boolean
}

export type RegisterResult = RegisterOk | { ok: false; error: string }

export async function registerOwner(input: RegisterInput): Promise<RegisterResult> {
  const companyName = input.companyName.trim()
  const email = input.email.trim().toLowerCase()
  const { password } = input

  if (companyName.length < 2) {
    return { ok: false, error: 'Informe o nome da empresa.' }
  }
  if (!email.includes('@') || email.length < 5) {
    return { ok: false, error: 'E-mail inválido.' }
  }
  if (password.length < 8) {
    return { ok: false, error: 'A senha precisa de ao menos 8 caracteres.' }
  }

  const slug = slugify(companyName)
  if (!slug) {
    return { ok: false, error: 'Nome da empresa inválido — use letras ou números.' }
  }

  // Duplicata: nome (slug) ou e-mail já cadastrados.
  if (await db.tenant.findUnique({ where: { slug } })) {
    return { ok: false, error: 'Já existe uma empresa com esse nome. Tente outro.' }
  }
  if (await db.account.findUnique({ where: { email } })) {
    return { ok: false, error: 'Esse e-mail já tem cadastro. Faça login.' }
  }

  const { tenantId, accountId } = await provisionTenant({
    slug,
    name: companyName,
    ownerEmail: email,
    ownerPasswordHash: await hashPassword(password),
  })
  await startTrial(tenantId, 'essencial') // 14 dias de trial já no cadastro
  // A conta nasce válida mesmo se o e-mail não sair: o cadastro não pode falhar por causa do
  // provedor de e-mail. Mas o resultado do envio sobe junto, para a tela não mentir.
  const { sent } = await startEmailVerification({ id: accountId, email }, input.baseUrl)

  return { ok: true, accountId, tenantId, slug, email, emailSent: sent }
}

/**
 * Para onde mandar o dono recém-cadastrado. Se o e-mail de confirmação não saiu, ele cai na tela
 * de confirmação — que explica o que houve e tem o botão de reenviar — em vez de ir para o painel
 * esperando um e-mail que nunca chegaria.
 */
export function postSignupPath(result: RegisterOk): string {
  return result.emailSent ? '/atendente' : '/verificar-email?envio=falhou'
}

// ── Reenvio da confirmação ──────────────────────────────────────────────────
// Cada reenvio dispara um e-mail de verdade (e gasta cota do provedor), então tem teto POR CONTA:
// sem ele o botão vira uma máquina de spam contra a caixa do próprio dono. Estado em memória do
// processo — zera no reinício, como o teto do /signup; é freio de abuso, não contabilidade.

const RESEND_MAX_PER_WINDOW = 3
const RESEND_WINDOW_MS = 10 * 60_000 // 10 min
const resendStateByAccount = new Map<string, RateState>()

export type ResendResult = { ok: true; sent: boolean } | { ok: false; retryAfterSec: number }

/** Reemite o link de confirmação da conta, respeitando o teto de reenvios da janela. */
export async function resendVerification(
  account: { id: string; email: string },
  baseUrl: string,
  now = Date.now(),
): Promise<ResendResult> {
  // Janelas vencidas não valem nada: descarta antes de contar, senão o Map cresce sem fim.
  for (const [accountId, state] of resendStateByAccount) {
    if (now - state.windowStart >= RESEND_WINDOW_MS) {
      resendStateByAccount.delete(accountId)
    }
  }

  const previous = resendStateByAccount.get(account.id) ?? { windowStart: now, count: 0 }
  const rate = checkRate(now, previous, RESEND_MAX_PER_WINDOW, RESEND_WINDOW_MS)
  resendStateByAccount.set(account.id, rate.state)
  if (!rate.allowed) {
    return { ok: false, retryAfterSec: rate.retryAfterSec }
  }

  const { sent } = await startEmailVerification(account, baseUrl)
  return { ok: true, sent }
}
