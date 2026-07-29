import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { parseTenantConfig } from './attendant/tenant-config'
import { provisionTenant } from './provisioning.server'

const SLUG = 'zzz-m23-prov'
const EMAIL = 'zzz-m23@owner.local'

afterEach(async () => {
  const tenant = await db.tenant.findUnique({ where: { slug: SLUG } })
  if (tenant) {
    await db.membership.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenantConfigRecord.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.delete({ where: { id: tenant.id } })
  }
  const acc = await db.account.findUnique({ where: { email: EMAIL } })
  if (acc) {
    await db.account.delete({ where: { id: acc.id } })
  }
})

describe('provisionTenant (M2.3)', () => {
  it('cria Tenant + config default válido + Account owner + Membership(owner)', async () => {
    const { tenantId, accountId } = await provisionTenant({
      slug: SLUG,
      name: 'Prov Teste',
      ownerEmail: EMAIL,
      ownerPasswordHash: 'salt:hash',
    })

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      include: { configRecord: true, memberships: true },
    })
    expect(tenant?.slug).toBe(SLUG)
    expect(tenant?.memberships[0]?.role).toBe('owner')
    expect(tenant?.memberships[0]?.accountId).toBe(accountId)

    // o config default gravado no banco é válido pelo parser real
    const config = parseTenantConfig(SLUG, JSON.parse(tenant?.configRecord?.json ?? '{}'))
    expect(config.escalationPolicy.defaultReason).toBe('config_indisponivel')

    const acc = await db.account.findUnique({ where: { id: accountId } })
    expect(acc?.email).toBe(EMAIL)
  })

  it('leva o NOME real da empresa pro config (nunca o slug técnico)', async () => {
    const { tenantId } = await provisionTenant({
      slug: SLUG,
      name: 'Advocacia GAC',
      ownerEmail: EMAIL,
      ownerPasswordHash: 'salt:hash',
    })

    const record = await db.tenantConfigRecord.findUnique({ where: { tenantId } })
    const config = parseTenantConfig(SLUG, JSON.parse(record?.json ?? '{}'))
    expect(config.businessProfile.name).toBe('Advocacia GAC')
    expect(config.businessProfile.name).not.toBe(SLUG)
    // o slug segue mandando no que é técnico (pasta da base de conhecimento)
    expect(config.knowledge.sourceDir).toBe(`knowledge/${SLUG}`)
  })

  it('sem nome informado, cai no slug em vez de gravar config inválido', async () => {
    const { tenantId } = await provisionTenant({
      slug: SLUG,
      name: '   ',
      ownerEmail: EMAIL,
      ownerPasswordHash: 'salt:hash',
    })

    const record = await db.tenantConfigRecord.findUnique({ where: { tenantId } })
    const config = parseTenantConfig(SLUG, JSON.parse(record?.json ?? '{}'))
    expect(config.businessProfile.name).toBe(SLUG)
  })

  it('é idempotente: 2x não duplica tenant, config, account nem membership', async () => {
    const first = await provisionTenant({
      slug: SLUG,
      name: 'Prov',
      ownerEmail: EMAIL,
      ownerPasswordHash: 'salt:hash',
    })
    const second = await provisionTenant({
      slug: SLUG,
      name: 'Prov',
      ownerEmail: EMAIL,
      ownerPasswordHash: 'salt:hash',
    })

    expect(second.tenantId).toBe(first.tenantId)
    expect(second.accountId).toBe(first.accountId)
    expect(await db.tenant.count({ where: { slug: SLUG } })).toBe(1)
    expect(await db.tenantConfigRecord.count({ where: { tenantId: first.tenantId } })).toBe(1)
    expect(await db.membership.count({ where: { tenantId: first.tenantId } })).toBe(1)
  })

  it('rejeita slug inválido', async () => {
    await expect(
      provisionTenant({ slug: 'Bad Slug!', name: 'x', ownerEmail: EMAIL, ownerPasswordHash: 'h' }),
    ).rejects.toThrow()
  })
})
