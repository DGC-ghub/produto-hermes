import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { db } from '../db.server'
import { ensureInitialTenants } from './tenants.server'

// Operadores (atendentes humanos) com senha. Hash via scrypt NATIVO do Node —
// sem dependência externa. Cada operador pertence a um tenant; o login carrega
// esse tenant na sessão e todo o resto (fila/dossiê/painel) é escopado por ele.

const scryptAsync = promisify(scrypt)
const KEY_LENGTH = 64
const SALT_BYTES = 16

/** Gera o hash de uma senha. Formato guardado: `<saltHex>:<hashHex>` (salt por senha). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString('hex')
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

/** Confere a senha contra o hash guardado, em tempo constante. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':')
  if (!salt || !hashHex) {
    return false
  }
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  const expected = Buffer.from(hashHex, 'hex')
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

export type AuthedOperator = {
  id: string
  username: string
  tenantId: string
  tenantSlug: string
}

/**
 * Autentica usuário + senha contra o banco. Retorna o operador (com o tenant) ou
 * `null`. Fail-closed: usuário inexistente e senha errada são indistinguíveis daqui.
 * Server-side (usa `db`).
 */
export async function authenticateOperator(
  username: string,
  password: string,
): Promise<AuthedOperator | null> {
  const operator = await db.operator.findUnique({
    where: { username },
    include: { tenant: { select: { slug: true } } },
  })
  if (!operator) {
    return null
  }
  if (!(await verifyPassword(password, operator.passwordHash))) {
    return null
  }
  return {
    id: operator.id,
    username: operator.username,
    tenantId: operator.tenantId,
    tenantSlug: operator.tenant.slug,
  }
}

/**
 * Garante um operador por tenant demo (idempotente) — username = slug do tenant,
 * senha = `OPERATOR_SEED_PASSWORD` (default de dev). É a versão MVP do cadastro de
 * operadores; uma tela de gestão entra depois. Server-side.
 */
export async function ensureSeedOperators(): Promise<void> {
  const tenants = await ensureInitialTenants()
  const seedPassword = process.env.OPERATOR_SEED_PASSWORD ?? 'hermes-dev'
  for (const tenant of tenants) {
    const existing = await db.operator.findUnique({ where: { username: tenant.slug } })
    if (existing) {
      continue
    }
    await db.operator.create({
      data: {
        username: tenant.slug,
        passwordHash: await hashPassword(seedPassword),
        tenantId: tenant.id,
      },
    })
  }
}
