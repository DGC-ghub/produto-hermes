// CLI da migração de dados M1.2: Operator -> Account + Membership(owner).
// Idempotente — pode rodar mais de uma vez. Aplica ao banco do DATABASE_URL.
//   npx tsx scripts/migrate-operators-to-accounts.ts
import { migrateOperatorsToAccounts } from '../app/lib/account-migration.server'

const r = await migrateOperatorsToAccounts()
for (const u of r.contas) {
  console.log(`Account criada a partir do operador "${u}" (login legado preservado, role=owner).`)
}
console.log(`\nMigração: ${r.criados} criada(s), ${r.pulados} já existia(m).`)
process.exit(0)
