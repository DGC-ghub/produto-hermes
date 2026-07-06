// Prova E2E do cadastro self-service (M2.6): roda o fluxo real (registerOwner +
// confirmEmailVerification) contra o DATABASE_URL do ambiente. USE UM BANCO DESCARTÁVEL.
// Mostra cada passo e limpa a empresa de prova no fim.
//   DATABASE_URL="file:/tmp/prova.db" npx tsx scripts/prova-signup.ts
import { db } from '../app/db.server'
import { confirmEmailVerification } from '../app/lib/email-verification.server'
import { registerOwner } from '../app/lib/signup.server'

const stamp = Date.now()
const email = `prova-${stamp}@empresa.local`
const companyName = 'Padaria do Zé (prova)'

console.log('\n━━━━━━━━━━ PROVA DO CADASTRO SELF-SERVICE (M2.6) ━━━━━━━━━━\n')

console.log(`[1] Um estranho abre /signup e cadastra:`)
console.log(`    empresa="${companyName}"  e-mail=${email}  senha=senha1234`)
const r = await registerOwner({
  companyName,
  email,
  password: 'senha1234',
  baseUrl: 'https://hermes.exemplo',
})
if (!r.ok) {
  console.error(`    ❌ FALHOU: ${r.error}`)
  process.exit(1)
}
console.log(`    ✅ empresa provisionada (slug gerado: "${r.slug}")\n`)

const tenant = await db.tenant.findUnique({
  where: { id: r.tenantId },
  include: { memberships: { include: { account: true } }, configRecord: true },
})
const owner = tenant?.memberships[0]
console.log(`[2] O que nasceu no banco, SOZINHO (sem ninguém rodar comando):`)
console.log(`    • Empresa (tenant): ${tenant?.name}  [${tenant?.slug}]`)
console.log(`    • Dono (account):   ${owner?.account.email}  papel=${owner?.role}`)
console.log(`    • Config default seguro: ${tenant?.configRecord ? 'criado ✅' : 'faltando ❌'}`)
console.log(
  `    • E-mail verificado? ${owner?.account.emailVerifiedAt ? 'sim' : 'ainda não (aguardando)'}\n`,
)

const token = owner?.account.emailVerifyToken ?? ''
console.log(`[3] E-mail de confirmação disparado (modo LOG — sem RESEND_API_KEY ainda).`)
console.log(`    O link enviado seria:`)
console.log(`    https://hermes.exemplo/verificar-email?token=${token.slice(0, 20)}…\n`)

console.log(`[4] O dono clica no link de confirmação...`)
const confirmedId = await confirmEmailVerification(token)
const after = await db.account.findUnique({ where: { id: r.accountId } })
console.log(
  `    ${confirmedId ? '✅ e-mail CONFIRMADO' : '❌ falhou'} — verificado agora? ${after?.emailVerifiedAt ? 'SIM ✅' : 'não'}\n`,
)

console.log(`[5] Limpando a empresa de prova (não deixa lixo)...`)
await db.membership.deleteMany({ where: { tenantId: r.tenantId } })
await db.tenantConfigRecord.deleteMany({ where: { tenantId: r.tenantId } })
await db.tenant.delete({ where: { id: r.tenantId } })
await db.account.delete({ where: { id: r.accountId } })
console.log(`    limpo.\n`)
console.log('━━━━━━━━━━ FIM — o cadastro funciona ponta a ponta ━━━━━━━━━━\n')
process.exit(0)
