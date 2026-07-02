// Cria (ou rotaciona a senha de) um operador de um tenant — a credencial PRÓPRIA
// de cada cliente, em vez da senha seed compartilhada dos tenants demo.
//
// Uso:
//   npm run operator:add -- <tenant-slug> <username> [senha]
//   (sem senha: gera uma forte e imprime UMA vez — anote na hora)
//
// Ex.: npm run operator:add -- csmed csmed-maria
import { randomBytes } from 'node:crypto'
import { db } from '../app/db.server'
import { hashPassword } from '../app/lib/operators.server'
import { resolveTenant } from '../app/lib/tenants.server'

try {
  process.loadEnvFile()
} catch {
  // sem .env (ex.: CI) — segue com o ambiente do shell
}

const [slug, username, passwordArg] = process.argv.slice(2)

if (!slug || !username) {
  console.error('Uso: npm run operator:add -- <tenant-slug> <username> [senha]')
  process.exit(1)
}
if (!/^[a-z0-9][a-z0-9._-]{2,40}$/.test(username)) {
  console.error('username inválido: use minúsculas/números/._- (3 a 41 caracteres)')
  process.exit(1)
}

const tenant = await resolveTenant(slug)
if (!tenant) {
  console.error(`Tenant desconhecido: "${slug}"`)
  process.exit(1)
}

const password = passwordArg ?? randomBytes(9).toString('base64url')
const passwordHash = await hashPassword(password)

const existing = await db.operator.findUnique({ where: { username } })
if (existing && existing.tenantId !== tenant.id) {
  console.error(`username "${username}" já pertence a OUTRO tenant — escolha outro nome.`)
  process.exit(1)
}

if (existing) {
  await db.operator.update({ where: { username }, data: { passwordHash } })
  console.log(`Senha ROTACIONADA para o operador "${username}" (tenant ${tenant.slug}).`)
} else {
  await db.operator.create({ data: { username, passwordHash, tenantId: tenant.id } })
  console.log(`Operador CRIADO: "${username}" (tenant ${tenant.slug}).`)
}

if (!passwordArg) {
  console.log(`Senha gerada (anote AGORA, não fica salva em lugar nenhum): ${password}`)
}
