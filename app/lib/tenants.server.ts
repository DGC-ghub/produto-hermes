import { db } from '../db.server'

export type TenantInput = {
  slug: string
  name: string
}

export const INITIAL_TENANTS = [
  { slug: 'dgc', name: 'DGC Hub' },
  { slug: 'assistencia-tecnica-demo', name: 'ResolveTech Assistência (Demo)' },
] as const

const SAFE_SLUG = /^[a-z0-9-]+$/

/**
 * Garante que um tenant exista no banco (cria se não há, atualiza o name se já há).
 * Server-side — usa o cliente Prisma. Retorna o tenant salvo.
 */
export async function ensureTenant(input: TenantInput) {
  if (!SAFE_SLUG.test(input.slug)) {
    throw new Error(`Invalid tenant slug: ${input.slug}`)
  }

  return db.tenant.upsert({
    where: { slug: input.slug },
    update: { name: input.name },
    create: { slug: input.slug, name: input.name },
  })
}

/**
 * Garante os tenants iniciais do MVP: dgc e assistencia-tecnica-demo.
 */
export async function ensureInitialTenants() {
  return Promise.all(INITIAL_TENANTS.map((tenant) => ensureTenant(tenant)))
}
