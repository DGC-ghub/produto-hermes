// CLI do marco M2.4: leva config + knowledge de arquivo pro banco (idempotente).
// Roda no cutover, contra o DATABASE_URL do ambiente.
//   npx tsx scripts/seed-config-knowledge.ts
import { seedConfigAndKnowledgeToDb } from '../app/lib/config-knowledge-seed.server'

const r = await seedConfigAndKnowledgeToDb()
console.log(
  `Seed config/knowledge → banco: ${r.configs} config(s), ${r.docs} doc(s) em ${r.tenants.length} tenant(s).`,
)
if (r.tenants.length > 0) {
  console.log(`Tenants tocados: ${r.tenants.join(', ')}`)
}
process.exit(0)
