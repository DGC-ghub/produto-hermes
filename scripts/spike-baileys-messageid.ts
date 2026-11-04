// SPIKE — o Baileys respeita um `messageId` que a gente escolhe, e o WhatsApp deduplica?
//
// Se sim, o canal QR (padrão do produto) ganha reenvio seguro: dá para tentar de novo com o
// MESMO id sem entregar duas mensagens. Se não, o QR herda a ambiguidade irredutível da Meta.
//
// ⚠️ NÃO é código de produção. Envia mensagem REAL. Rode com docs/spike-baileys-messageid.md.
//
// AUTÔNOMO DE PROPÓSITO: cria o próprio socket a partir do auth salvo, sem tocar em
// `baileys.server.ts`. Uma "porta de teste" exportada de lá poderia ser esquecida e ir para o
// deploy — e o experimento não vale abrir o socket do produto para o resto do sistema.
//
// DUAS FASES, porque uma só não responde a pergunta:
//   fase 1 — repete o id no MESMO socket. Se deduplicar, pode ser cache da instância.
//   fase 2 — fecha o socket, recria a conexão do auth persistido e repete o id. É esta que
//            corresponde ao caso real (o processo caiu e outro assumiu).
// T3 só entra no plano se a FASE 2 também deduplicar.

import makeWASocket, { fetchLatestWaWebVersion, generateMessageID } from '@whiskeysockets/baileys'
import { db } from '../app/db.server'
import { useDbAuthState } from '../app/lib/channels/baileys-auth.server'

/**
 * CONTROLE NEGATIVO — o par que discrimina.
 *
 * Três envios com o mesmo id resultando em UMA bolha é compatível com duas explicações
 * opostas: o WhatsApp deduplicou, ou só uma das três chegou. Uma execução anterior deste
 * mesmo spike teve três `key.id` devolvidos e ZERO entregas (endereço errado), então
 * "recibo do provedor" não distingue nada.
 *
 * Com `SPIKE_CONTROLE=1` o script manda três mensagens com ids DIFERENTES. Se chegarem três,
 * a entrega é confiável e a bolha única do outro modo foi deduplicação de verdade. Se chegar
 * uma de novo, o que existe é entrega não confiável — e a conclusão é a oposta.
 */
const modoControle = process.env.SPIKE_CONTROLE === '1'

const sessionId = process.env.SPIKE_SESSION_ID ?? ''
const to = process.env.SPIKE_TO ?? ''
const toConfirma = process.env.SPIKE_TO_CONFIRMA ?? ''
const tenantEsperado = process.env.SPIKE_TENANT ?? ''

/** Sai com mensagem, sem stack. */
function abortar(motivo: string): never {
  console.error(`\n❌ ${motivo}\n`)
  process.exit(1)
}

if (!sessionId || !to || !toConfirma || !tenantEsperado) {
  abortar(
    'Faltou variável. Obrigatórias: SPIKE_SESSION_ID, SPIKE_TENANT, SPIKE_TO, SPIKE_TO_CONFIRMA.\n' +
      '   Veja docs/spike-baileys-messageid.md',
  )
}
// O destino é digitado DUAS vezes porque mandar mensagem para o número errado não tem desfazer.
if (to !== toConfirma) {
  abortar(`SPIKE_TO e SPIKE_TO_CONFIRMA não batem (${to} ≠ ${toConfirma}). Nada foi enviado.`)
}
if (!/^\d{10,15}$/.test(to)) {
  abortar(`SPIKE_TO deve ser só dígitos com DDI+DDD (ex.: 5511999998888). Recebi: ${to}`)
}

// ── Ambiente: o script tem que estar falando com o banco DO SERVIÇO ─────────
//
// Sem isto ele abriria o `dev.db` do checkout por fallback e não acharia a sessão — ou, pior,
// acharia uma sessão velha e tentaria decifrar o auth com a chave errada.
const url = process.env.DATABASE_URL
if (!url) {
  abortar(
    'DATABASE_URL não está no ambiente. Sem ele o script cai no dev.db do checkout por\n' +
      '   fallback. Carregue o .env do serviço antes (ver o roteiro).',
  )
}
if (!process.env.SECRETS_ENCRYPTION_KEY && !process.env.SESSION_SECRET) {
  abortar('Sem SECRETS_ENCRYPTION_KEY/SESSION_SECRET não dá para decifrar o auth da sessão.')
}
if (process.env.BAILEYS_ENABLED !== '1') {
  abortar('BAILEYS_ENABLED não é "1" — o canal QR está desligado neste ambiente.')
}

// ── A sessão: validada SEMPRE, não só quando falta confirmação ─────────────
//
// A primeira versão deste script só consultava o tenant quando a confirmação estava AUSENTE.
// Com a confirmação presente ele aceitava qualquer sessão, inclusive a que atende cliente: a
// variável removia o aviso, não o risco.
const sessao = await db.channelSession.findUnique({
  where: { id: sessionId },
  select: {
    kind: true,
    status: true,
    authStateEnc: true,
    tenant: { select: { slug: true } },
  },
})

if (!sessao) abortar(`Sessão ${sessionId} não existe neste banco (${url}).`)
if (sessao.kind !== 'baileys') {
  abortar(`Sessão ${sessionId} não é do canal QR (kind=${sessao.kind}).`)
}
if (!sessao.authStateEnc) {
  abortar(`Sessão ${sessionId} não tem pareamento salvo. Pareie em /canais antes.`)
}
if (sessao.tenant.slug !== tenantEsperado) {
  abortar(
    `A sessão pertence a "${sessao.tenant.slug}", e você declarou "${tenantEsperado}".\n` +
      '   Nada foi enviado. Confira o id da sessão.',
  )
}

/**
 * CONFIRMAÇÃO NOMINAL do risco — não um "sim" genérico.
 *
 * Abrir uma segunda conexão com as credenciais de uma sessão pareada pode derrubá-la, e aí
 * alguém precisa escanear o QR de novo. Quem autoriza tem que NOMEAR a empresa e a sessão: um
 * `=sim` solto foi exatamente o defeito da primeira versão deste script — removia o aviso sem
 * remover o risco, e aceitava qualquer sessão, inclusive a errada.
 *
 * As duas variáveis são conferidas contra o que está no banco. Errar de sessão exige errar
 * duas vezes, escrevendo o id certo da sessão errada.
 */
const riscoAceito = process.env.SPIKE_ACEITO_RISCO_TENANT ?? ''
const sessaoEsperada = process.env.SPIKE_EXPECTED_SESSION_ID ?? ''

if (riscoAceito !== sessao.tenant.slug) {
  abortar(
    `Falta a confirmação nominal do risco desta empresa.\n` +
      `   A sessão pertence a "${sessao.tenant.slug}". Para prosseguir, declare:\n` +
      `   SPIKE_ACEITO_RISCO_TENANT=${sessao.tenant.slug}\n` +
      '   (a sessão pode cair e exigir novo pareamento por QR)',
  )
}
if (sessaoEsperada !== sessionId) {
  abortar(
    'Falta SPIKE_EXPECTED_SESSION_ID, ou ele não bate com SPIKE_SESSION_ID.\n' +
      '   As duas precisam nomear a MESMA sessão — é a segunda barreira contra rodar na errada.',
  )
}

/**
 * O serviço tem que estar PARADO.
 *
 * Duas conexões com as mesmas credenciais brigam, e é assim que a sessão cai. Verificar o
 * processo é mais confiável que confiar no passo do roteiro ter sido seguido.
 */
const { execSync } = await import('node:child_process')

/** Quantos processos do servidor ainda vivem. O padrão evita casar com o próprio comando. */
function processosDoServidor(): number {
  try {
    const saida = execSync("pgrep -f 'node .*server[.]js' 2>/dev/null || true").toString().trim()
    return saida ? saida.split('\n').filter(Boolean).length : 0
  } catch {
    return 0
  }
}

const flagAtiva =
  execSync('systemctl --user is-active hermes 2>/dev/null || true').toString().trim() === 'active'
if (flagAtiva) {
  abortar(
    'O serviço hermes está ATIVO. Ele mantém o próprio socket desta sessão, e duas conexões\n' +
      '   com as mesmas credenciais brigam.\n' +
      '   Pare antes:  systemctl --user stop hermes',
  )
}

/**
 * A FLAG NÃO BASTA — e foi assim que a primeira execução falhou.
 *
 * `systemctl stop` volta assim que marca o serviço inativo, mas o processo ainda leva um tempo
 * para fechar o socket do WhatsApp. Na primeira tentativa o `systemctl` disse `inactive`, havia
 * dois processos vivos, e o WhatsApp respondeu `Connection Failure` — exatamente a briga de duas
 * conexões que este roteiro existe para evitar, acontecendo no procedimento em vez de no
 * experimento.
 *
 * O que importa é o PROCESSO ter morrido, não a flag ter mudado.
 */
process.stdout.write('esperando o processo do servidor encerrar')
let vivos = processosDoServidor()
for (let i = 0; vivos > 0 && i < 30; i += 1) {
  process.stdout.write('.')
  await new Promise((r) => setTimeout(r, 1000))
  vivos = processosDoServidor()
}
console.log(vivos === 0 ? ' encerrado ✅' : '')
if (vivos > 0) {
  abortar(
    `Ainda há ${vivos} processo(s) do servidor vivos depois de 30s.\n` +
      '   Conectar agora brigaria pelo pareamento. Investigue antes:  pgrep -af server.js',
  )
}
// Folga extra: o socket do WhatsApp pode demorar um pouco mais que o processo a soltar.
await new Promise((r) => setTimeout(r, 3000))

/** Fila vazia: não vale rodar com mensagem de alguém esperando processamento. */
const emVoo = await db.webhookEvent.count({ where: { status: { in: ['pending', 'processing'] } } })
if (emVoo > 0) {
  abortar(`Há ${emVoo} evento(s) na fila (pending/processing). Espere esvaziar antes do spike.`)
}

// ── O ENDEREÇO DE ENTREGA ───────────────────────────────────────────────────
//
// O WhatsApp novo endereça por `@lid` (número oculto), e responder aos dígitos reconstruídos
// vai para o VÁCUO — o comentário está em `whatsapp-queue.server.ts` e a coluna `remoteJid`
// existe por causa disso. A primeira execução deste spike ignorou o aviso, mandou para
// `<digitos>@s.whatsapp.net`, recebeu `key.id` nos três envios, e NADA foi entregue.
//
// Isso virou um achado por acidente: comprovante do provedor não é prova de entrega.
//
// Aqui o endereço vem do último inbound real daquele contato, que é a fonte de verdade — o
// mesmo caminho que o produto usa para responder.
// O inbound é escolhido pelo ID DO EVENTO, não por casar telefone.
//
// No `@lid` o `contactId` é um identificador opaco — 14/15 dígitos, não é telefone e não dá
// para derivar um a partir do outro. Uma trava que compare com o número declarado barra o
// contato certo (foi o que aconteceu na tentativa anterior). Quem identifica o inbound sem
// ambiguidade é a chave primária dele, confirmada por quem autorizou.
const inboundId = process.env.SPIKE_INBOUND_ID ?? ''
if (!inboundId) {
  abortar('Falta SPIKE_INBOUND_ID — o id do evento de entrada que define o destino.')
}

const inbound = await db.webhookEvent.findUnique({
  where: { id: inboundId },
  select: { remoteJid: true, contactId: true, channelSessionId: true, text: true, createdAt: true },
})

if (!inbound) abortar(`Inbound ${inboundId} não existe neste banco.`)
if (inbound.channelSessionId !== sessionId) {
  abortar('O inbound informado é de OUTRA sessão. Nada foi enviado.')
}
if (!inbound.remoteJid) {
  abortar(
    'Esse inbound não tem `remoteJid` — sem ele não há endereço real de entrega, e mandar\n' +
      '   para os dígitos reconstruídos vai para o vácuo.',
  )
}

/**
 * Mais de um candidato = aborta.
 *
 * Se chegou mensagem nova depois da autorização, o "último inbound" mudou e o destino
 * confirmado pode não ser mais o que o autorizador viu.
 */
const inboundsDepois = await db.webhookEvent.count({
  where: {
    channelSessionId: sessionId,
    remoteJid: { not: null },
    createdAt: { gt: inbound.createdAt },
  },
})
if (inboundsDepois > 0) {
  abortar(
    `Chegaram ${inboundsDepois} mensagem(ns) DEPOIS do inbound autorizado.\n` +
      '   O destino confirmado pode não ser mais o correto. Reconfirme antes de enviar.',
  )
}

const jid = inbound.remoteJid
console.log(`inbound:  "${inbound.text.slice(0, 12)}" de ${inbound.createdAt.toISOString()}`)
console.log(`destino:  ***${jid.slice(-8)} (mascarado — @lid do inbound autorizado)`)
// Id no formato da PRÓPRIA versão instalada: se o WhatsApp normalizar ou recusar um formato
// inventado, não dá para distinguir "id inválido" de "não deduplica".
const idRepetido = generateMessageID()
const texto = `Teste do Hermes (spike). Pode ignorar. ref ${idRepetido.slice(-8)}`

function comLimite<T>(promessa: Promise<T>, ms: number, oQue: string): Promise<T> {
  return Promise.race([
    promessa,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${oQue}`)), ms)),
  ])
}

type Socket = ReturnType<typeof makeWASocket>
const abertos: Socket[] = []

/**
 * A versão do WA Web — a mesma coisa que o produto faz, e a causa das duas primeiras falhas.
 *
 * Sem passar `version`, o Baileys usa a embutida no pacote (`7.0.0-rc13`), que está defasada, e
 * o WhatsApp recusa o handshake com `statusCode=405 Connection Failure`. O comentário em
 * `baileys.server.ts` já avisava: "se falhar ou vier defasada, o pareamento pode ser recusado".
 * O spike não pode divergir do produto justamente no que faz a conexão ser aceita.
 */
let versaoWa: [number, number, number] | undefined
try {
  const { version } = await fetchLatestWaWebVersion({})
  versaoWa = version
  console.log(`versão do WA Web: ${version.join('.')}`)
} catch (e) {
  console.log(`⚠️  não consegui buscar a versão do WA Web (${e instanceof Error ? e.message : e})`)
  console.log('   seguindo com o default do pacote — o handshake pode ser recusado com 405')
}

async function abrirSocket(rotulo: string): Promise<{ sock: Socket; fechar: () => Promise<void> }> {
  // O prefixo `use` é convenção do Baileys para provedores de auth-state, não React.
  // biome-ignore lint/correctness/useHookAtTopLevel: não é hook React — função de servidor
  const auth = await useDbAuthState(sessionId)
  const sock = makeWASocket({
    version: versaoWa,
    auth: auth.state,
    printQRInTerminal: false,
    browser: ['Mac OS', 'Chrome', '14.4.1'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  })
  abertos.push(sock)
  sock.ev.on('creds.update', auth.saveCreds)

  await comLimite(
    new Promise<void>((resolve, reject) => {
      sock.ev.on('connection.update', (u) => {
        if (u.connection === 'open') resolve()
        if (u.qr) reject(new Error('a sessão pediu QR — o pareamento não está mais válido'))
        if (u.connection === 'close') {
          // O código do Boom diz POR QUE o WhatsApp recusou — 401/403 é pareamento inválido,
          // 440 é sessão substituída, 428 é conexão fechada. Sem ele, "fechou antes de abrir"
          // não distingue "tente de novo" de "não adianta insistir".
          const erro = u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
          const codigo = erro?.output?.statusCode
          const detalhe = u.lastDisconnect?.error?.message ?? 'sem detalhe'
          reject(
            new Error(
              `a conexão fechou antes de abrir (statusCode=${codigo ?? 'nenhum'}: ${detalhe})`,
            ),
          )
        }
      })
    }),
    45_000,
    `conectar (${rotulo})`,
  )

  return {
    sock,
    fechar: async () => {
      // `end` derruba o socket SEM gravar `desconectado` no banco — diferente do
      // `disconnect()` do produto, que mudaria o status e impediria o boot de retomar.
      sock.end(undefined)
      await auth.flush()
    },
  }
}

async function enviar(sock: Socket, rotulo: string): Promise<string> {
  // No controle cada envio leva um id NOVO — é isso que testa a entrega, não a deduplicação.
  const idDoEnvio = modoControle ? generateMessageID() : idRepetido
  const corpo = modoControle ? `${texto} [controle ${rotulo}]` : texto
  const r = await comLimite(
    sock.sendMessage(jid, { text: corpo }, { messageId: idDoEnvio }),
    30_000,
    `enviar (${rotulo})`,
  )
  const id = (r as { key?: { id?: string } } | undefined)?.key?.id
  console.log(`   ${rotulo}: key.id = ${id ?? '(vazio)'} ${id === idDoEnvio ? '✅' : '❌'}`)
  return id ?? ''
}

// ── Limpeza garantida, inclusive em Ctrl+C ─────────────────────────────────
let limpando = false
async function limpar(): Promise<void> {
  if (limpando) return
  limpando = true
  for (const s of abertos) {
    try {
      s.end(undefined)
    } catch {
      /* já caiu */
    }
  }
  await db.$disconnect().catch(() => {})
}
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    void limpar().then(() => process.exit(130))
  })
}

// ── O experimento ───────────────────────────────────────────────────────────
console.log('\n── SPIKE: messageId repetido no Baileys ──')
console.log(`empresa:  ${sessao.tenant.slug}`)
console.log(`sessão:   ${sessionId}`)
console.log(`declarado: ${to.slice(0, 4)}***${to.slice(-4)} (telefone; o envio usa o @lid)`)
console.log(
  modoControle
    ? 'MODO CONTROLE: três ids DIFERENTES — testa ENTREGA, não deduplicação\n'
    : `id:       ${idRepetido}\n`,
)

let id1 = ''
let id2 = ''
let id3 = ''
let erro3: string | null = null

try {
  console.log('FASE 1 — mesmo socket, id repetido')
  const a = await abrirSocket('fase 1')
  id1 = await enviar(a.sock, '1º envio')
  await new Promise((r) => setTimeout(r, 3000))
  id2 = await enviar(a.sock, '2º envio')
  await a.fechar()

  console.log('\nFASE 2 — socket RECRIADO do auth persistido, mesmo id')
  console.log('   (é esta que corresponde ao caso real: o processo caiu e outro assumiu)')
  await new Promise((r) => setTimeout(r, 3000))
  const b = await abrirSocket('fase 2')
  try {
    id3 = await enviar(b.sock, '3º envio')
  } catch (e) {
    erro3 = e instanceof Error ? e.message : String(e)
    console.log(`   3º envio lançou: ${erro3}`)
  }
  await b.fechar()
} finally {
  await limpar()
}

// ── Veredito do terminal (metade da resposta) ──────────────────────────────
if (modoControle) {
  console.log('\n── CONTROLE: o que esperar ──')
  console.log('  • 3 bolhas → a entrega é confiável. A bolha única do outro modo foi DEDUPLICAÇÃO.')
  console.log('  • menos de 3 → a entrega NÃO é confiável, e o resultado anterior não prova dedup.')
  console.log('\nProcure por "[controle" nas mensagens.\n')
  await limpar()
  process.exit(0)
}

console.log('\n── O QUE O TERMINAL DIZ ──')
if (id1 !== idRepetido) {
  console.log('❌ A biblioteca IGNOROU o id logo no 1º envio. A hipótese cai aqui.')
} else if (id2 !== idRepetido || id3 !== idRepetido) {
  console.log('⚠️  O id foi respeitado só em parte:')
  console.log(`   1º: ok`)
  console.log(`   2º: ${id2 === idRepetido ? 'ok' : id2 || '(vazio)'}`)
  console.log(
    `   3º: ${erro3 ? `lançou (${erro3})` : id3 === idRepetido ? 'ok' : id3 || '(vazio)'}`,
  )
  console.log('   Reenvio seguro exige que os TRÊS batam — como está, a hipótese não se sustenta.')
} else {
  console.log('✅ A biblioteca respeitou o id nos três envios.')
}

console.log('\n── O QUE SÓ O APARELHO DIZ ──')
console.log('Conte as mensagens de teste no celular que recebeu:')
console.log('  • 1 bolha  → deduplicou nas duas fases. A hipótese se confirma.')
console.log('  • 2 bolhas → deduplicou em uma fase só. Anote QUAL — muda a conclusão.')
console.log('  • 3 bolhas → não deduplica. A hipótese cai.')
console.log('\nAnote em docs/spike-baileys-messageid.md, seção "Resultado".\n')
