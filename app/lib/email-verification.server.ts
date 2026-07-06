import { randomBytes } from 'node:crypto'
import { db } from '../db.server'
import { sendEmail } from './email.server'

// Verificação de e-mail no cadastro (marco M2.6): gera um token, guarda no Account com validade,
// e manda o link de confirmação. Sem e-mail verificado, o uso do cérebro caro fica bloqueado
// (anti trial-farming). Server-side.

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24h

/** Gera token, grava no Account e dispara o e-mail de confirmação. Retorna o token (útil em teste). */
export async function startEmailVerification(
  account: { id: string; email: string },
  baseUrl: string,
): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  await db.account.update({
    where: { id: account.id },
    data: { emailVerifyToken: token, emailVerifyExpiresAt: expiresAt },
  })

  const link = `${baseUrl.replace(/\/$/, '')}/verificar-email?token=${token}`
  await sendEmail({
    to: account.email,
    subject: 'Confirme seu e-mail — Hermes',
    html: `<p>Bem-vindo ao Hermes!</p><p>Confirme seu e-mail para ativar o atendimento:</p><p><a href="${link}">${link}</a></p><p>O link vale por 24 horas.</p>`,
  })
  return token
}

/**
 * Valida um token de confirmação. Se válido e não expirado, marca o e-mail como verificado e
 * limpa o token. Retorna o accountId confirmado, ou null (token inválido/expirado). Idempotente
 * no sentido de que um token já usado (limpo) não valida de novo.
 */
export async function confirmEmailVerification(token: string): Promise<string | null> {
  if (!token) {
    return null
  }
  const account = await db.account.findUnique({ where: { emailVerifyToken: token } })
  if (!account?.emailVerifyExpiresAt) {
    return null
  }
  if (account.emailVerifyExpiresAt.getTime() < Date.now()) {
    return null // expirado
  }
  await db.account.update({
    where: { id: account.id },
    data: { emailVerifiedAt: new Date(), emailVerifyToken: null, emailVerifyExpiresAt: null },
  })
  return account.id
}
