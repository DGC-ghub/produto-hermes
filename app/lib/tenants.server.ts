import { db } from '../db.server'

export type TenantInput = {
  slug: string
  name: string
}

export const INITIAL_TENANTS = [
  { slug: 'dgc', name: 'DGC Hub' },
  { slug: 'assistencia-tecnica-demo', name: 'ResolveTech Assistência (Demo)' },
  { slug: 'prestacon', name: 'Prestacon Contabilidade' },
  { slug: 'csmed', name: 'Carvalho Serviços Médicos (CS MED)' },
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

/**
 * Resolve um tenant pelo slug a partir do BANCO (fonte de verdade) — é isto que
 * permite adicionar um cliente novo só criando o registro, sem editar código nem
 * fazer redeploy. Se o tenant ainda não existe mas é um dos seeds conhecidos
 * (`INITIAL_TENANTS`), cria on-demand, preservando o comportamento de MVP. Slug
 * inválido ou desconhecido → `null` (o chamador decide como rejeitar). Server-side.
 */
export async function resolveTenant(slug: string) {
  if (!SAFE_SLUG.test(slug)) {
    return null
  }
  const existing = await db.tenant.findUnique({ where: { slug } })
  if (existing) {
    return existing
  }
  const seed = INITIAL_TENANTS.find((tenant) => tenant.slug === slug)
  return seed ? ensureTenant(seed) : null
}
