// Prova E2E da credencial de WhatsApp POR TENANT (M4.2): registra um número, mostra o
// fallback pro token global do env, grava a credencial própria (cifrada) e prova que o
// banco vence o env e que o texto claro NÃO fica guardado. USE UM BANCO DESCARTÁVEL.
// Limpa a empresa de prova no fim.
//   DATABASE_URL="file:/tmp/prova-wa.db" npx tsx scripts/prova-whatsapp-credential.ts
import { db } from '../app/db.server'
import { ensureTenant } from '../app/lib/tenants.server'
import { registerWhatsappNumber } from '../app/lib/whatsapp.server'
import {
  resolveWhatsappCredential,
  setWhatsappCredential,
} from '../app/lib/whatsapp-credential.server'

process.env.SESSION_SECRET ||= 'prova-session-secret-para-cifra'
const SLUG = 'prova-wa-cred'
const PHONE = 'PROVA_WA_PHONE_1'

console.log('\n━━━━━━━━━━ PROVA: credencial de WhatsApp por tenant (M4.2) ━━━━━━━━━━\n')

console.log('[1] Cadastra uma empresa de prova e registra o número dela:')
await ensureTenant({ slug: SLUG, name: 'Empresa da Prova (WA)' })
await registerWhatsappNumber(PHONE, SLUG, 'Número principal')
console.log(`    empresa="${SLUG}"  número(phone_number_id)="${PHONE}"\n`)

console.log('[2] ANTES de conectar credencial própria: o envio usa o TOKEN GLOBAL do env')
process.env.WHATSAPP_ACCESS_TOKEN = 'TOKEN-GLOBAL-DO-ENV'
let cred = await resolveWhatsappCredential(PHONE)
console.log(`    resolve → "${cred.accessToken}"  (cai no env = pilotos intactos ✅)\n`)

console.log('[3] O cliente conecta o WhatsApp dele → grava a credencial PRÓPRIA (cifrada):')
await setWhatsappCredential(PHONE, {
  accessToken: 'TOKEN-PROPRIO-DO-CLIENTE',
  appSecret: 'APP-SECRET-DO-CLIENTE',
})
cred = await resolveWhatsappCredential(PHONE)
console.log(`    resolve → "${cred.accessToken}"  (agora o BANCO vence o env ✅)\n`)

console.log('[4] Como fica GUARDADO no banco (cifrado em repouso, AES-256-GCM + AAD tenant):')
const row = await db.whatsappNumber.findUnique({
  where: { phoneNumberId: PHONE },
  select: { accessTokenEnc: true },
})
console.log(`    accessTokenEnc = ${row?.accessTokenEnc?.slice(0, 48)}…`)
const vazou = row?.accessTokenEnc?.includes('TOKEN-PROPRIO-DO-CLIENTE')
console.log(`    contém o texto claro? ${vazou ? 'SIM ❌' : 'NÃO ✅ (só a cifra)'}\n`)

console.log('[5] Limpando a empresa de prova (não deixa lixo)...')
await db.whatsappNumber.deleteMany({ where: { tenant: { slug: SLUG } } })
await db.tenant.deleteMany({ where: { slug: SLUG } })
console.log('    limpo.\n')
console.log(
  '━━━━━━━━━━ FIM — 2º cliente envia com token próprio; pilotos seguem no env ━━━━━━━━━━\n',
)
process.exit(0)
