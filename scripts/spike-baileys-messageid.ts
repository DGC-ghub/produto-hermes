// SPIKE — o Baileys respeita um `messageId` que a gente escolhe?
//
// A pergunta vale muito: se ele respeitar, o canal QR (que é o padrão do produto) ganha
// reenvio seguro — dá para tentar de novo com o MESMO id e o WhatsApp tratar como a mesma
// mensagem. Se não respeitar, o QR herda a mesma ambiguidade irredutível da Meta, e um envio
// que "talvez tenha saído" nunca poderá ser repetido automaticamente.
//
// Isto NÃO é código de produção. É um experimento que manda mensagem de VERDADE para um
// número de verdade. Rode com o roteiro em docs/spike-baileys-messageid.md ao lado.
//
// Uso:
//   SPIKE_SESSION_ID=<id da sessão> SPIKE_TO=<número destino, só dígitos> \
//     npx tsx scripts/spike-baileys-messageid.ts

import { db } from '../app/db.server'

const sessionIdBruto = process.env.SPIKE_SESSION_ID
const toBruto = process.env.SPIKE_TO

if (!sessionIdBruto || !toBruto) {
  console.error('Faltou SPIKE_SESSION_ID e/ou SPIKE_TO. Veja docs/spike-baileys-messageid.md')
  process.exit(1)
}
if (!/^\d{10,15}$/.test(toBruto)) {
  console.error(`SPIKE_TO deve ser só dígitos com DDI+DDD (ex.: 5511999998888). Recebi: ${toBruto}`)
  process.exit(1)
}

// Já validados acima: daqui para baixo são strings, sem `!` espalhado pelo arquivo.
const sessionId: string = sessionIdBruto
const to: string = toBruto

// Trava de segurança: o spike não pode rodar contra a sessão que atende cliente de verdade.
// A confirmação é explícita e por engano não acontece.
if (process.env.SPIKE_EU_SEI_O_QUE_ESTOU_FAZENDO !== 'sim') {
  const sessao = await db.channelSession.findUnique({
    where: { id: sessionId },
    select: { status: true, tenant: { select: { slug: true } } },
  })
  console.error(
    `\nEste spike ENVIA MENSAGEM REAL pela sessão ${sessionId}` +
      (sessao
        ? ` (empresa "${sessao.tenant.slug}", status "${sessao.status}")`
        : ' (não achei no banco)') +
      '\n\nUse uma sessão DEDICADA ao teste, nunca a de um cliente. Se for isso mesmo, repita' +
      ' com SPIKE_EU_SEI_O_QUE_ESTOU_FAZENDO=sim\n',
  )
  process.exit(1)
}

const { startPairing, getSessionView, disconnect } = await import(
  '../app/lib/channels/baileys.server'
)

/** O id que vamos repetir. Prefixo reconhecível para achar no aparelho e no log. */
const ID_REPETIDO = `SPIKE${Date.now()}`

async function esperarConexao(segundos = 60): Promise<boolean> {
  for (let i = 0; i < segundos; i += 1) {
    const view = getSessionView(sessionId)
    if (view.status === 'conectado') return true
    if (i === 0 && view.qr) {
      console.log('\n⚠️  A sessão pediu QR. Isso significa que ela NÃO estava pareada.')
      console.log('   Pareie pela tela /canais antes de rodar o spike.\n')
      return false
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

console.log(`\n── SPIKE: messageId repetido no Baileys ──`)
console.log(`sessão:  ${sessionId}`)
console.log(`destino: ${to}`)
console.log(`id que será repetido: ${ID_REPETIDO}\n`)

console.log('1) conectando a sessão a partir do auth salvo…')
await startPairing(sessionId)
if (!(await esperarConexao())) {
  console.error('❌ a sessão não conectou em 60s — abortando sem enviar nada')
  await db.$disconnect()
  process.exit(1)
}
console.log('   conectado ✅\n')

// O `sendText` do produto não expõe `messageId` — o spike fala com o socket direto, porque a
// pergunta é sobre a BIBLIOTECA, não sobre o nosso wrapper.
const { __socketDaSessaoParaSpike } = (await import('../app/lib/channels/baileys.server')) as {
  __socketDaSessaoParaSpike?: (id: string) => {
    sendMessage: (
      jid: string,
      conteudo: { text: string },
      opcoes?: { messageId?: string },
    ) => Promise<{ key?: { id?: string } } | undefined>
  } | null
}

if (!__socketDaSessaoParaSpike) {
  console.error(
    '❌ falta o acessório de spike em baileys.server.ts.\n' +
      '   Ver docs/spike-baileys-messageid.md, seção "o que o spike precisa do código".',
  )
  await disconnect(sessionId)
  await db.$disconnect()
  process.exit(1)
}

const sock = __socketDaSessaoParaSpike(sessionId)
if (!sock) {
  console.error('❌ socket não encontrado para a sessão')
  await db.$disconnect()
  process.exit(1)
}

const jid = `${to}@s.whatsapp.net`
const texto = `Teste do Hermes — id ${ID_REPETIDO}. Pode ignorar.`

console.log('2) primeiro envio, com o id escolhido por nós…')
const primeiro = await sock.sendMessage(jid, { text: texto }, { messageId: ID_REPETIDO })
const idDoPrimeiro = (primeiro as { key?: { id?: string } })?.key?.id
console.log(`   devolveu key.id = ${idDoPrimeiro}`)
console.log(
  `   ${idDoPrimeiro === ID_REPETIDO ? '✅ respeitou o id que pedimos' : '❌ IGNOROU o id e usou outro'}\n`,
)

await new Promise((r) => setTimeout(r, 3000))

console.log('3) segundo envio, com o MESMO id…')
let idDoSegundo: string | undefined
let erroDoSegundo: string | null = null
try {
  const segundo = await sock.sendMessage(jid, { text: texto }, { messageId: ID_REPETIDO })
  idDoSegundo = (segundo as { key?: { id?: string } })?.key?.id
  console.log(`   devolveu key.id = ${idDoSegundo}`)
} catch (e) {
  erroDoSegundo = e instanceof Error ? e.message : String(e)
  console.log(`   lançou: ${erroDoSegundo}`)
}

console.log('\n── O QUE ISTO SIGNIFICA ──')
if (idDoPrimeiro !== ID_REPETIDO) {
  console.log('❌ A biblioteca IGNOROU o messageId. A hipótese cai: sem controle do id, não há')
  console.log('   reenvio seguro no Baileys. O canal QR herda a ambiguidade da Meta.')
} else {
  console.log('✅ A biblioteca respeitou o id nos dois envios.')
  console.log('   AGORA OLHE O APARELHO QUE RECEBEU — é ele que dá a resposta final:')
  console.log('   • UMA bolha  → o WhatsApp deduplicou. Reenvio seguro é possível.')
  console.log('   • DUAS bolhas → o id não deduplica no servidor. A hipótese cai igual.')
}
console.log('\nAnote o resultado em docs/spike-baileys-messageid.md, seção "Resultado".\n')

console.log('4) desconectando a sessão do spike (sem logout — o pareamento continua)…')
await disconnect(sessionId)
await db.$disconnect()
