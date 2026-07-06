import { db } from '../../db.server'
import { parseTenantConfig, serializeTenantConfig, type TenantConfig } from './tenant-config'

// Acesso ao TenantConfig pelo BANCO (marco M2.2). Espelha loadTenantConfig/saveTenantConfig
// (que usam arquivo) reusando parseTenantConfig/serializeTenantConfig — a validação é a MESMA,
// só a fonte muda. É async (o banco é async); trocar os callers do motor pela fonte-banco
// espera a decisão A/B/C do design (docs/design-m2-provisionamento.md). Server-side.

/** Carrega o config do banco (TenantConfigRecord.json), ou null se o tenant não tem registro. */
export async function loadTenantConfigFromDb(slug: string): Promise<TenantConfig | null> {
  const tenant = await db.tenant.findUnique({
    where: { slug },
    include: { configRecord: true },
  })
  if (!tenant?.configRecord) {
    return null
  }
  return parseTenantConfig(slug, JSON.parse(tenant.configRecord.json))
}

/** Grava o config no banco (upsert por tenant). Revalida pelo mesmo caminho do arquivo. */
export async function saveTenantConfigToDb(config: TenantConfig): Promise<void> {
  const tenant = await db.tenant.findUnique({ where: { slug: config.slug } })
  if (!tenant) {
    throw new Error(`Tenant não encontrado para o config: ${config.slug}`)
  }
  // Revalida (serialize → parse): nunca persiste algo que não carregaria de volta.
  const validated = parseTenantConfig(config.slug, JSON.parse(serializeTenantConfig(config)))
  const json = serializeTenantConfig(validated)
  await db.tenantConfigRecord.upsert({
    where: { tenantId: tenant.id },
    create: { tenantId: tenant.id, json },
    update: { json },
  })
}
