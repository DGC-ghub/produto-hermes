import { db } from '../db.server'
import { hashPassword, verifyPassword } from './operators.server'
import { DEMO_TENANT_SLUGS, ensureInitialTenants } from './tenants.server'

// Contas de LOGIN (marco M1.3). Uma Account autentica por e-mail OU pelo login legado
// (username=slug dos operadores migrados em M1.2), e o Membership dá o papel (owner|operator)
// no tenant. Reaproveita o hash scrypt de operators.server.ts. A IA nunca toca isto.

export type AuthedAccount = {
  accountId: string
  email: string
  role: string
  tenantId: string
  tenantSlug: string
}

/**
 * Autentica por e-mail OU login legado + senha. Retorna a conta com o papel e o tenant do
 * primeiro vínculo, ou `null`. Fail-closed: conta inexistente e senha errada são
 * indistinguíveis daqui. Server-side (usa `db`).
 */
export async function authenticateAccount(
  login: string,
  password: string,
): Promise<AuthedAccount | null> {
  const account = await db.account.findFirst({
    where: { OR: [{ email: login }, { legacyUsername: login }] },
    include: { memberships: { include: { tenant: { select: { slug: true } } } } },
  })
  if (!account) {
    return null
  }
  if (!(await verifyPassword(password, account.passwordHash))) {
    return null
  }
  // Por ora uma conta tem um vínculo; escolher entre vários tenants no login é futuro (M2+).
  const membership = account.memberships[0]
  if (!membership) {
    return null
  }
  return {
    accountId: account.id,
    email: account.email,
    role: membership.role,
    tenantId: membership.tenantId,
    tenantSlug: membership.tenant.slug,
  }
}

/**
 * Garante um Account(role=owner) por tenant DE DEMONSTRAÇÃO (idempotente) — e-mail
 * `<slug>@demo.local`, login legado = slug, senha = `OPERATOR_SEED_PASSWORD`. Igual ao seed
 * de operadores: tenant de cliente REAL recebe conta própria (signup em M2 / migração em M1.2),
 * nunca seed. Fail-closed em produção, como o SESSION_SECRET. Server-side.
 */
export async function ensureSeedAccounts(): Promise<void> {
  const seedPassword = process.env.OPERATOR_SEED_PASSWORD
  if (process.env.NODE_ENV === 'production') {
    if (!seedPassword || seedPassword === 'hermes-dev' || seedPassword.length < 12) {
      throw new Error(
        'OPERATOR_SEED_PASSWORD em produção precisa existir, ter 12+ caracteres e não ser o default de dev.',
      )
    }
  }
  const tenants = await ensureInitialTenants()
  const effectivePassword = seedPassword ?? 'hermes-dev'
  for (const tenant of tenants) {
    if (!DEMO_TENANT_SLUGS.includes(tenant.slug)) {
      continue
    }
    const existing = await db.account.findUnique({ where: { legacyUsername: tenant.slug } })
    if (existing) {
      continue
    }
    await db.account.create({
      data: {
        email: `${tenant.slug}@demo.local`,
        passwordHash: await hashPassword(effectivePassword),
        legacyUsername: tenant.slug,
        memberships: { create: { tenantId: tenant.id, role: 'owner' } },
      },
    })
  }
}
