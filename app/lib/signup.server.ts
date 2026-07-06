import { db } from '../db.server'
import { startEmailVerification } from './email-verification.server'
import { hashPassword } from './operators.server'
import { provisionTenant } from './provisioning.server'

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

export type RegisterResult =
  | { ok: true; accountId: string; tenantId: string; slug: string; email: string }
  | { ok: false; error: string }

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
  await startEmailVerification({ id: accountId, email }, input.baseUrl)

  return { ok: true, accountId, tenantId, slug, email }
}
