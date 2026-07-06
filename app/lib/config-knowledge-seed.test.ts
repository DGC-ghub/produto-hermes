import { afterEach, describe, expect, it } from 'vitest'
import { safeDefaultConfig } from './attendant/tenant-config'
import { loadTenantConfigFromDb, saveTenantConfigToDb } from './attendant/tenant-config-db.server'
import { seedConfigAndKnowledgeToDb } from './config-knowledge-seed.server'
import { db } from '../db.server'

// SLUG de teste SEM arquivo de config/knowledge — e escopamos o seed a ele (nunca slug real
// como 'dgc', que outras suítes criam via ensureInitialTenants, e nem o seed global).
const SLUG = 'zzz-m24-seed'

async function cleanup(slug: string) {
  const tenant = await db.tenant.findUnique({ where: { slug } })
  if (!tenant) {
    return
  }
  await db.tenantConfigRecord.deleteMany({ where: { tenantId: tenant.id } })
  await db.knowledgeDoc.deleteMany({ where: { tenantId: tenant.id } })
  await db.membership.deleteMany({ where: { tenantId: tenant.id } })
  await db.tenant.delete({ where: { id: tenant.id } })
}

afterEach(() => cleanup(SLUG))

describe('seedConfigAndKnowledgeToDb (M2.4)', () => {
  it('NÃO sobrescreve um config que já está no banco (idempotente)', async () => {
    const tenant = await db.tenant.create({ data: { slug: SLUG, name: 'M24' } })
    await saveTenantConfigToDb({
      ...safeDefaultConfig(SLUG),
      businessProfile: { name: 'Editado na tela', segment: 'x', tone: 'y' },
    }) // simula edição prévia via tela

    const r = await seedConfigAndKnowledgeToDb([SLUG])

    expect(r.configs).toBe(0) // já tinha config → não semeia por cima
    const loaded = await loadTenantConfigFromDb(SLUG)
    expect(loaded?.businessProfile.name).toBe('Editado na tela')
    expect(await db.tenantConfigRecord.count({ where: { tenantId: tenant.id } })).toBe(1)
  })

  it('pula gracioso um tenant SEM arquivo (não cria registro nem quebra)', async () => {
    const tenant = await db.tenant.create({ data: { slug: SLUG, name: 'M24' } })

    const r = await seedConfigAndKnowledgeToDb([SLUG])

    expect(r.configs).toBe(0)
    expect(r.docs).toBe(0)
    expect(
      await db.tenantConfigRecord.findUnique({ where: { tenantId: tenant.id } }),
    ).toBeNull()
  })
})
