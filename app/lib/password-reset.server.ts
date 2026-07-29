import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from '../db.server'
import { sendEmail } from './email.server'
import { hashPassword } from './operators.server'

// Recuperação de senha SEM tabela de tokens: o link carrega um token ASSINADO (payload +
// assinatura HMAC-SHA256, em base64url), então nada precisa ser gravado no banco. É o mesmo
// truque do Django, e ele dá DUAS propriedades de graça:
//
//  (a) EXPIRAÇÃO VERIFICÁVEL SEM ESTADO — o instante de validade viaja dentro do payload e está
//      coberto pela assinatura. Empurrar a data pra frente quebra a assinatura, então dá pra
//      confiar no prazo sem guardar nada.
//  (b) USO ÚNICO AUTOMÁTICO — a chave do HMAC é derivada do SESSION_SECRET COMBINADO com o
//      passwordHash ATUAL da conta. No instante em que a senha muda, o hash muda, a chave muda
//      junto e o token antigo para de validar sozinho. Sem coluna "usado", sem limpeza.
//
// Server-side (usa `db`).

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1h — janela curta: e-mail encaminhado/vazado envelhece rápido

/** Segredo do processo. Espelha o fail-closed do auth.server.ts: em produção não há default. */
function resetSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET é obrigatório em produção (assina o link de reset de senha).')
    }
    return 'dev-insecure-secret-change-me'
  }
  return secret
}

/** Chave do HMAC: o segredo do processo AMARRADO ao hash de senha atual — daí o uso único (b). */
function tokenKey(passwordHash: string): Buffer {
  return createHmac('sha256', resetSecret())
    .update(`hermes-password-reset-v1:${passwordHash}`)
    .digest()
}

function sign(encodedPayload: string, passwordHash: string): string {
  return createHmac('sha256', tokenKey(passwordHash)).update(encodedPayload).digest('base64url')
}

export type ResetClaim = { accountId: string; expiresAt: number }

/**
 * Emite o token de redefinição para uma conta. `now` é parâmetro pra testar prazo sem relógio
 * falso. Puro (não toca o banco).
 */
export function issueResetToken(
  account: { id: string; passwordHash: string },
  now: number = Date.now(),
): string {
  const encoded = Buffer.from(`${account.id}:${now + TOKEN_TTL_MS}`, 'utf8').toString('base64url')
  return `${encoded}.${sign(encoded, account.passwordHash)}`
}

/**
 * Lê o payload SEM conferir a assinatura — serve só pra descobrir QUAL conta buscar (a chave do
 * HMAC depende do hash dela). Nada aqui é confiável até `checkResetToken` passar.
 */
export function readResetToken(token: string): ResetClaim | null {
  const [encoded] = token.split('.')
  if (!encoded) {
    return null
  }
  const [accountId, expiresAt] = Buffer.from(encoded, 'base64url').toString('utf8').split(':')
  const expiresAtMs = Number(expiresAt)
  if (!accountId || !Number.isFinite(expiresAtMs)) {
    return null
  }
  return { accountId, expiresAt: expiresAtMs }
}

/**
 * Validação de verdade: assinatura (em tempo constante) e prazo. Passa o `passwordHash` ATUAL da
 * conta — se a senha já mudou, a chave não é mais a mesma e a assinatura não bate. Puro.
 */
export function checkResetToken(
  token: string,
  passwordHash: string,
  now: number = Date.now(),
): ResetClaim | null {
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) {
    return null
  }
  const expected = Buffer.from(sign(encoded, passwordHash), 'utf8')
  const received = Buffer.from(signature, 'utf8')
  // timingSafeEqual exige mesmo tamanho: compara o comprimento antes (isso não vaza segredo).
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null
  }
  const claim = readResetToken(token)
  if (!claim || claim.expiresAt <= now) {
    return null
  }
  return claim
}

/**
 * Dispara o e-mail com o link de redefinição, se existir conta com esse e-mail. Retorna se
 * enviou — útil em teste. A ROTA ignora esse retorno de propósito: a resposta ao visitante é
 * sempre a mesma, senão o formulário vira um oráculo de "esse e-mail tem conta aqui?".
 */
export async function startPasswordReset(email: string, baseUrl: string): Promise<boolean> {
  const account = await db.account.findUnique({ where: { email: email.trim().toLowerCase() } })
  if (!account) {
    return false
  }
  const token = issueResetToken(account)
  const link = `${baseUrl.replace(/\/$/, '')}/redefinir-senha?token=${encodeURIComponent(token)}`
  await sendEmail({
    to: account.email,
    subject: 'Redefinir sua senha — Hermes',
    html: `<p>Recebemos um pedido para redefinir a senha da sua conta no Hermes.</p><p><a href="${link}">${link}</a></p><p>O link vale por 1 hora e deixa de funcionar assim que a senha for trocada.</p><p>Se não foi você, ignore este e-mail — sua senha continua a mesma.</p>`,
  })
  return true
}

/** A conta apontada por um token VÁLIDO (assinatura + prazo conferidos), ou null. */
export async function accountForResetToken(
  token: string,
): Promise<{ id: string; email: string } | null> {
  const claim = token ? readResetToken(token) : null
  if (!claim) {
    return null
  }
  const account = await db.account.findUnique({ where: { id: claim.accountId } })
  if (!account) {
    return null
  }
  return checkResetToken(token, account.passwordHash)
    ? { id: account.id, email: account.email }
    : null
}

export type ResetOutcome = { ok: true; email: string } | { ok: false; error: string }

export const INVALID_TOKEN_ERROR = 'Link inválido ou expirado. Peça um novo.'

/**
 * Troca a senha da conta do token. Usa o MESMO scrypt do resto do produto
 * (`hashPassword`), então o login continua funcionando sem nenhum caso especial. Depois disto o
 * token que veio no e-mail já não vale — o hash mudou, ver (b) no topo.
 */
export async function completePasswordReset(input: {
  token: string
  password: string
  confirmation: string
}): Promise<ResetOutcome> {
  const account = await accountForResetToken(input.token)
  if (!account) {
    return { ok: false, error: INVALID_TOKEN_ERROR }
  }
  if (input.password.length < 8) {
    return { ok: false, error: 'A senha precisa de ao menos 8 caracteres.' }
  }
  if (input.password !== input.confirmation) {
    return { ok: false, error: 'As senhas não conferem.' }
  }
  await db.account.update({
    where: { id: account.id },
    data: { passwordHash: await hashPassword(input.password) },
  })
  return { ok: true, email: account.email }
}
