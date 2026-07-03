import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import {
  DEMO_TENANT_SLUGS,
  ensureInitialTenants,
  ensureTenant,
  INITIAL_TENANTS,
  resolveTenant,
} from './tenants.server'

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

describe('resolveTenant', () => {
  const R_SLUG = 'zzz-test-resolve-tenant'

  afterEach(async () => {
    await db.tenant.deleteMany({ where: { slug: R_SLUG } })
  })

  it('devolve null para slug desconhecido (não cria sujeira no banco)', async () => {
    expect(await resolveTenant('zzz-slug-que-nao-existe')).toBeNull()
  })

  it('devolve null para slug inseguro', async () => {
    expect(await resolveTenant('../dgc')).toBeNull()
  })

  it('resolve um tenant já existente no banco — mesmo sem ser um seed', async () => {
    await ensureTenant({ slug: R_SLUG, name: 'Resolve Test' })
    const tenant = await resolveTenant(R_SLUG)
    expect(tenant?.slug).toBe(R_SLUG)
    expect(tenant?.name).toBe('Resolve Test')
  })

  it('cria on-demand um seed conhecido (dgc)', async () => {
    const tenant = await resolveTenant('dgc')
    expect(tenant?.slug).toBe('dgc')
    expect(tenant?.name).toBe('DGC Hub')
  })
})

describe('DEMO_TENANT_SLUGS', () => {
  it('nunca expõe tenant de cliente real na demo pública', () => {
    expect(DEMO_TENANT_SLUGS).not.toContain('csmed')
    expect(DEMO_TENANT_SLUGS).not.toContain('prestacon')
  })

  it('só contém slugs que existem em INITIAL_TENANTS', () => {
    const known = INITIAL_TENANTS.map((t) => t.slug) as readonly string[]
    for (const slug of DEMO_TENANT_SLUGS) {
      expect(known).toContain(slug)
    }
  })
})
