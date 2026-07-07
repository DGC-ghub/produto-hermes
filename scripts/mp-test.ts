// Valida o MP_ACCESS_TOKEN DE VERDADE: chama /users/me (read-only — não cria cobrança,
// não move dinheiro). Carrega o .env automaticamente. Rode:
//   npm run mp:test
import 'dotenv/config'
import { getMpAccount } from '../app/lib/mercadopago.server'

const hasToken = !!process.env.MP_ACCESS_TOKEN
console.log(
  `\n[mp:test] MP_ACCESS_TOKEN: ${hasToken ? 'presente ✅' : 'AUSENTE ❌ (stub — não valida)'}`,
)
if (!hasToken) {
  console.log('   Cole o token no .env (MP_ACCESS_TOKEN) e rode de novo.')
  console.log('   Passo a passo: docs/mercadopago-setup.md\n')
  process.exit(1)
}

console.log('[mp:test] Validando o token no Mercado Pago (GET /users/me, read-only)...\n')
const acc = await getMpAccount()
if (!acc) {
  console.log('❌ Token inválido ou rede indisponível.')
  console.log('   Confira se copiou o Access Token de PRODUÇÃO (não a Public Key).\n')
  process.exit(1)
}

console.log('✅ Token válido! Conta do Mercado Pago conectada:')
console.log(`   • ID:      ${acc.id}`)
console.log(`   • Apelido: ${acc.nickname ?? '—'}`)
console.log(`   • Site:    ${acc.siteId ?? '—'} (MLB = Brasil)`)
console.log(`   • E-mail:  ${acc.email ?? '—'}\n`)
console.log('Pronto pra receber assinaturas. Próximo: apontar a URL do webhook')
console.log('(<seu-domínio>/webhook/mercadopago) no painel do MP.\n')
process.exit(0)
