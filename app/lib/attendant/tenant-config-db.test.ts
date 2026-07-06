import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../../db.server'
import { safeDefaultConfig } from './tenant-config'
import { loadTenantConfigFromDb, saveTenantConfigToDb } from './tenant-config-db.server'

const SLUG = 'zzz-m22-cfg'

afterEach(async () => {
  const tenant = await db.tenant.findUnique({ where: { slug: SLUG } })
  if (tenant) {
    await db.tenantConfigRecord.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.delete({ where: { id: tenant.id } })
  }
})

describe('config no banco (M2.2)', () => {
  it('roundtrip: save → load devolve o mesmo config', async () => {
    await db.tenant.create({ data: { slug: SLUG, name: 'M22 Cfg' } })
    const config = {
      ...safeDefaultConfig(SLUG),
      businessProfile: { name: 'Acme', segment: 'saúde', tone: 'cordial' },
    }
    await saveTenantConfigToDb(config)

    const loaded = await loadTenantConfigFromDb(SLUG)
    expect(loaded?.slug).toBe(SLUG)
    expect(loaded?.businessProfile.name).toBe('Acme')
    expect(loaded?.knowledge.sourcePolicy).toBe('answer_only_from_knowledge')
  })

  it('load devolve null quando o tenant não tem registro', async () => {
    await db.tenant.create({ data: { slug: SLUG, name: 'M22 Cfg' } })
    expect(await loadTenantConfigFromDb(SLUG)).toBeNull()
  })

  it('save lança se o tenant não existe', async () => {
    await expect(saveTenantConfigToDb(safeDefaultConfig(SLUG))).rejects.toThrow()
  })
})
