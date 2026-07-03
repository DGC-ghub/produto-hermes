import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { ensureInitialTenants, ensureTenant } from './tenants.server'

const TEST_SLUG = 'zzz-test-tenant-task-9'

afterEach(async () => {
  // Limpa apenas o tenant de teste — nunca os tenants reais (dgc / assistencia-tecnica-demo).
  await db.tenant.deleteMany({ where: { slug: TEST_SLUG } })
})

describe('ensureTenant', () => {
  it('creates a new tenant', async () => {
    const tenant = await ensureTenant({ slug: TEST_SLUG, name: 'Teste Task 9' })

    expect(tenant.slug).toBe(TEST_SLUG)
    expect(tenant.name).toBe('Teste Task 9')

    const found = await db.tenant.findUnique({ where: { slug: TEST_SLUG } })
    expect(found?.name).toBe('Teste Task 9')
  })

  it('is idempotent and updates the name on the same record', async () => {
    const first = await ensureTenant({ slug: TEST_SLUG, name: 'Nome A' })
    const second = await ensureTenant({ slug: TEST_SLUG, name: 'Nome B' })

    expect(second.id).toBe(first.id)
    expect(second.name).toBe('Nome B')

    const all = await db.tenant.findMany({ where: { slug: TEST_SLUG } })
    expect(all.length).toBe(1)
  })

  it('rejects an unsafe slug', async () => {
    await expect(ensureTenant({ slug: '../dgc', name: 'x' })).rejects.toThrow('Invalid tenant slug')
  })
})

describe('ensureInitialTenants', () => {
  it('ensures dgc and assistencia-tecnica-demo exist', async () => {
    await ensureInitialTenants()

    const dgc = await db.tenant.findUnique({ where: { slug: 'dgc' } })
    const demo = await db.tenant.findUnique({ where: { slug: 'assistencia-tecnica-demo' } })

    expect(dgc?.name).toBe('DGC Hub')
    expect(demo?.name).toBe('ResolveTech Assistência (Demo)')
  })
})
