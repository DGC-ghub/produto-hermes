// Cria/atualiza um tenant SEM editar código — fecha o achado da auditoria de que
// cliente novo exigia commit em INITIAL_TENANTS — e, opcionalmente, já mapeia o
// número do WhatsApp (tabela WhatsappNumber, sem redeploy).
//
// Uso:
//   npm run tenant:add -- <slug> "<Nome da Empresa>" [phoneNumberId]
// Ex.: npm run tenant:add -- clinica-x "Clínica X" 259213483946012
try {
  process.loadEnvFile()
} catch {
  // sem .env — segue com o ambiente do shell
}

const [slug, name, phoneNumberId] = process.argv.slice(2)

if (!slug || !name) {
  console.error('Uso: npm run tenant:add -- <slug> "<Nome da Empresa>" [phoneNumberId]')
  process.exit(1)
}

// Imports dinâmicos DEPOIS do loadEnvFile: o client do banco lê DATABASE_URL no import.
const { db } = await import('../app/db.server')
const { ensureTenant } = await import('../app/lib/tenants.server')
const { registerWhatsappNumber } = await import('../app/lib/whatsapp.server')

const tenant = await ensureTenant({ slug, name }) // valida o slug e faz upsert
console.log(`Tenant ok: ${tenant.slug} — "${tenant.name}"`)

if (phoneNumberId) {
  await registerWhatsappNumber(phoneNumberId, slug)
  console.log(`Número ${phoneNumberId} → ${slug} mapeado no banco (sem redeploy).`)
}

console.log('Próximos passos do onboarding:')
console.log(`  1. config/tenants/${slug}.json (copie de um tenant parecido)`)
console.log(`  2. knowledge/${slug}/ (a base que o atendente pode citar)`)
console.log(`  3. npm run operator:add -- ${slug} <username>  (credencial própria)`)
console.log('  4. cenários no banco de provas (scripts/eval-motor.ts) antes de ligar')

await db.$disconnect()

// Sem import estático (todos são dinâmicos, pós-loadEnvFile) — o export vazio
// marca o arquivo como módulo pro top-level await compilar.
export {}
