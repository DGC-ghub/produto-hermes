// LGPD (DGC-91): guarda por prazo e exclusão. Padrão é --dry-run (só conta); apagar de
// verdade exige --confirmar. O registro (uma linha JSON por execução) leva só contagens,
// ids internos e data — nunca conteúdo de mensagem nem telefone.
//
// Uso:
//   npm run lgpd:retencao -- [--confirmar]
//   npm run lgpd:apagar-contato -- --tenant <slug> --contato <contactId> [--confirmar]
//   (o --contato fica no histórico do shell: use `HISTCONTROL=ignorespace` e comece o comando com espaço)
//   Exige LGPD_HASH_SECRET (mín. 16 caracteres) no ambiente: o registro guarda o contato em HMAC.
//   npm run lgpd:apagar-tenant  -- --tenant <slug> [--confirmar]
//
// Registro: $LGPD_LOG (padrão ./logs/lgpd-apagados.jsonl). Rotina diária: deploy/lgpd-retencao.md.
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { ApagadoRelatorio } from '../app/lib/lgpd.server'

try {
  process.loadEnvFile()
} catch {
  // sem .env — segue com o ambiente do shell
}

const [comando, ...resto] = process.argv.slice(2)
const { values } = parseArgs({
  args: resto,
  options: {
    tenant: { type: 'string' },
    contato: { type: 'string' },
    confirmar: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
})

function uso(msg: string): never {
  console.error(`${msg}
Uso:
  lgpd retencao [--confirmar]
  lgpd apagar-contato --tenant <slug> --contato <contactId> [--confirmar]
  lgpd apagar-tenant --tenant <slug> [--confirmar]
Sem --confirmar, só mostra o que seria apagado (--dry-run).`)
  process.exit(1)
}

if (values.confirmar && values['dry-run']) uso('Use --confirmar OU --dry-run, não os dois.')
const dryRun = !values.confirmar

// Imports dinâmicos DEPOIS do loadEnvFile: o client do banco lê DATABASE_URL no import.
const { db } = await import('../app/db.server')
const { purgeExpired, deleteContact, deleteTenant } = await import('../app/lib/lgpd.server')

const logPath = process.env.LGPD_LOG ?? './logs/lgpd-apagados.jsonl'
if (!dryRun) mkdirSync(path.dirname(logPath), { recursive: true })

// Cada relatório é gravado assim que o tenant termina: se o seguinte falhar, o que já
// foi apagado não fica sem registro.
function registrar(rel: ApagadoRelatorio) {
  const linha = JSON.stringify(rel)
  console.log(linha)
  // Retenção sem nada a apagar não polui o registro.
  const total = Object.values(rel.contagens).reduce((a, b) => a + b, 0)
  if (!dryRun && (comando !== 'retencao' || total > 0)) appendFileSync(logPath, `${linha}\n`)
}

let falhou = false
if (comando === 'retencao') {
  const { erros } = await purgeExpired({ dryRun, onRelatorio: registrar })
  for (const e of erros) console.error(`ERRO no tenant ${e.tenant}: ${e.erro}`)
  falhou = erros.length > 0
} else if (comando === 'apagar-contato') {
  if (!values.tenant || !values.contato) uso('Faltou --tenant ou --contato.')
  registrar(await deleteContact({ tenantSlug: values.tenant, contactId: values.contato, dryRun }))
} else if (comando === 'apagar-tenant') {
  if (!values.tenant) uso('Faltou --tenant.')
  registrar(await deleteTenant({ tenantSlug: values.tenant, dryRun }))
} else {
  uso(`Comando desconhecido: ${comando ?? '(nenhum)'}`)
}

console.log(
  dryRun ? '[dry-run] nada foi apagado. Use --confirmar.' : `Apagado. Registro em ${logPath}`,
)
await db.$disconnect()
if (falhou) {
  console.error('Houve falhas: veja os erros acima. Saída com código 1.')
  process.exit(1)
}
