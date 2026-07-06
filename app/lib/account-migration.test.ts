import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { accountDataFromOperator, migrateOperatorsToAccounts } from './account-migration.server'

// Dados marcados só deste teste — o .test.db é compartilhado entre workers em paralelo,
// então limpamos apenas o que criamos (nunca deleteMany global).
const U = 'zzz-m1-op'
const SLUG = 'zzz-m1-tenant'

afterEach(async () => {
  const acc = await db.account.findUnique({ where: { legacyUsername: U } })
  if (acc) {
    await db.membership.deleteMany({ where: { accountId: acc.id } })
    await db.account.delete({ where: { id: acc.id } })
  }
  await db.operator.deleteMany({ where: { username: U } })
  await db.tenant.deleteMany({ where: { slug: SLUG } })
})

describe('accountDataFromOperator (puro)', () => {
  it('reaproveita o hash, deriva e-mail placeholder e vincula como owner', () => {
    const data = accountDataFromOperator({ username: 'acme', passwordHash: 's:h', tenantId: 't1' })
    expect(data.passwordHash).toBe('s:h')
    expect(data.email).toBe('acme@migrado.local')
    expect(data.legacyUsername).toBe('acme')
    expect(data.memberships.create).toEqual({ tenantId: 't1', role: 'owner' })
  })
})

describe('migrateOperatorsToAccounts', () => {
  it('migra um operator para Account + Membership(owner) com o hash intacto', async () => {
    const tenant = await db.tenant.create({ data: { slug: SLUG, name: 'M1 Teste' } })
    await db.operator.create({
      data: { username: U, passwordHash: 'salt:hash', tenantId: tenant.id },
    })

    await migrateOperatorsToAccounts()

    const acc = await db.account.findUnique({
      where: { legacyUsername: U },
      include: { memberships: true },
    })
    expect(acc?.passwordHash).toBe('salt:hash') // senha atual segue valendo
    expect(acc?.email).toBe(`${U}@migrado.local`)
    expect(acc?.memberships).toHaveLength(1)
    expect(acc?.memberships[0]?.role).toBe('owner')
    expect(acc?.memberships[0]?.tenantId).toBe(tenant.id)
  })

  it('é idempotente: reexecutar não duplica o mesmo operador', async () => {
    const tenant = await db.tenant.create({ data: { slug: SLUG, name: 'M1 Teste' } })
    await db.operator.create({
      data: { username: U, passwordHash: 'salt:hash', tenantId: tenant.id },
    })

    await migrateOperatorsToAccounts()
    const segunda = await migrateOperatorsToAccounts()

    expect(segunda.pulados).toBeGreaterThanOrEqual(1)
    const contas = await db.account.findMany({ where: { legacyUsername: U } })
    expect(contas).toHaveLength(1)
  })
})
