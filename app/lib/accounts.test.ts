import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { authenticateAccount } from './accounts.server'
import { hashPassword } from './operators.server'

// Dados marcados só deste teste (o .test.db é compartilhado entre workers).
const EMAIL = 'zzz-m13@test.local'
const LEGACY = 'zzz-m13-legacy'
const SLUG = 'zzz-m13-tenant'
const SENHA = 'senha-correta-123'

afterEach(async () => {
  const acc = await db.account.findFirst({
    where: { OR: [{ email: EMAIL }, { legacyUsername: LEGACY }] },
  })
  if (acc) {
    await db.membership.deleteMany({ where: { accountId: acc.id } })
    await db.account.delete({ where: { id: acc.id } })
  }
  await db.tenant.deleteMany({ where: { slug: SLUG } })
})

async function seed(role = 'owner') {
  const tenant = await db.tenant.create({ data: { slug: SLUG, name: 'M13 Teste' } })
  await db.account.create({
    data: {
      email: EMAIL,
      passwordHash: await hashPassword(SENHA),
      legacyUsername: LEGACY,
      memberships: { create: { tenantId: tenant.id, role } },
    },
  })
  return tenant
}

describe('authenticateAccount', () => {
  it('autentica por e-mail e retorna papel + tenant', async () => {
    const tenant = await seed('owner')
    const r = await authenticateAccount(EMAIL, SENHA)
    expect(r?.email).toBe(EMAIL)
    expect(r?.role).toBe('owner')
    expect(r?.tenantId).toBe(tenant.id)
    expect(r?.tenantSlug).toBe(SLUG)
  })

  it('autentica pelo login legado (username=slug) e traz o papel operator', async () => {
    await seed('operator')
    const r = await authenticateAccount(LEGACY, SENHA)
    expect(r?.role).toBe('operator')
    expect(r?.tenantSlug).toBe(SLUG)
  })

  it('senha errada → null (fail-closed)', async () => {
    await seed()
    expect(await authenticateAccount(EMAIL, 'errada')).toBeNull()
  })

  it('login inexistente → null', async () => {
    expect(await authenticateAccount('nao-existe@x.local', 'x')).toBeNull()
  })
})
