import { ensureInitialTenants } from '../app/lib/tenants.server'

// Smoke manual: garante os tenants iniciais no dev.db e imprime o resultado.
// Execução: ver docs/prompts (não há script em package.json por enquanto — YAGNI).
const tenants = await ensureInitialTenants()

console.log(
  JSON.stringify(
    tenants.map((tenant) => ({ slug: tenant.slug, name: tenant.name })),
    null,
    2,
  ),
)
