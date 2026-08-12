import type { Boom } from '@hapi/boom'
import makeWASocket, {
  DisconnectReason,
  fetchLatestWaWebVersion,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys'
import { db } from '../../db.server'
import { reportDegradation } from '../alarm.server'
import { type DbAuthState, useDbAuthState } from './baileys-auth.server'
import { installLibsignalLogGuard } from './libsignal-log-guard.server'
import type { InboundEvent, SendResult } from './types'

// `libsignal` escreve a sessão criptográfica inteira direto no console, ignorando o logger
// silencioso do socket. Instalar antes de qualquer conexão evita chaves privadas no log.
installLibsignalLogGuard()

// Gerente dos sockets Baileys (canal WhatsApp NÃO-oficial / QR). Um socket
// PERSISTENTE por sessão, vivendo no processo (como o sweeper da fila). Resolve os
// achados da verificação (docs/plano-vendavel-v1.md §5, Passo 4): filtra msg própria
// e histórico, reconecta por causa com backoff, ritmo anti-ban, boot/shutdown.

const REPAIR_GRACE_MS = 60_000 // msg mais velha que (conexão − isto) = backlog, ignora
const MAX_RECONNECTS = 6
const RECONNECT_BASE_MS = 2_000
const RECONNECT_CAP_MS = 60_000
const PACE_MIN_MS = 600
const PACE_PER_CHAR_MS = 25
const PACE_MAX_MS = 6_000
const DAILY_SOFT_CAP = 400 // acima disto só loga (bloquear deixaria cliente sem resposta)
// Teto POR CONTATO (rede anti-ping-pong): máx respostas a UM contato na janela abaixo.
const CONTACT_CAP = 12
const CONTACT_WINDOW_MS = 5 * 60_000

// O canal QR fica atrás de um flag — default OFF no rollout inicial pra proteger os
// pilotos Meta (o boot-reconnect e o pareamento não sobem sem isto).
export function isBaileysEnabled(): boolean {
  return process.env.BAILEYS_ENABLED === '1'
}

type SessionEntry = {
  sock: WASocket
  auth: DbAuthState
  status: string
  qr: string | null
  connectedAtMs: number | null
  reconnects: number
  closing: boolean
  sentToday: number
  sentDay: string
  reconnectTimer?: ReturnType<typeof setTimeout>
}

const sessions = new Map<string, SessionEntry>()

// contactId → remoteJid da última mensagem, por sessão. O WhatsApp novo endereça por
// @lid (número oculto), NÃO pelo telefone: responder aos dígitos reconstruídos
// (`<lid>@s.whatsapp.net`) manda a resposta pro vácuo (o cliente não recebe nada e o
// envio nem acusa erro). Guardamos o jid ORIGINAL de entrada e respondemos exatamente
// a ele. Em memória: a resposta é reativa e no MESMO processo da entrada, então o mapa
// sempre tem a chave na hora de responder; some no restart, mas a próxima entrada
// repovoa antes da próxima resposta.
const jidByContact = new Map<string, Map<string, string>>()
function rememberInboundJid(sessionId: string, contactId: string, remoteJid: string): void {
  let perSession = jidByContact.get(sessionId)
  if (!perSession) {
    perSession = new Map()
    jidByContact.set(sessionId, perSession)
  }
  perSession.set(contactId, remoteJid)
}

/**
 * Resolve o jid de RESPOSTA de uma sessão Baileys: um jid explícito (já tem `@`) vale;
 * senão o remoteJid ORIGINAL lembrado da entrada (cobre @lid); senão o telefone
 * reconstruído dos dígitos (contato só-número, ex. legado). Exportado p/ teste.
 */
export function resolveReplyJid(sessionId: string, to: string): string {
  if (to.includes('@')) {
    return to
  }
  const remembered = jidByContact.get(sessionId)?.get(to)
  if (remembered) {
    return remembered
  }
  return `${to.replace(/\D/g, '')}@s.whatsapp.net`
}

// Teto POR CONTATO: se o número conversar com OUTRO auto-respondedor, o fromMe não
// protege (contas diferentes) e vira loop infinito (~1 msg/20s) → ban. Um humano quase
// nunca precisa de >CONTACT_CAP respostas em CONTACT_WINDOW_MS; um loop de bots estoura e
// é suprimido. Por jid de destino. Exportado p/ teste.
const recentSends = new Map<string, number[]>()
export function overContactCap(jid: string): boolean {
  const now = Date.now()
  // Poda o vazamento lento: num processo 24/7 os jids se acumulariam no mapa. Quando ele
  // cresce, remove contatos totalmente fora da janela. Barato — só quando grande (FU2).
  if (recentSends.size > 1000) {
    for (const [k, times] of recentSends) {
      if (times.every((t) => now - t >= CONTACT_WINDOW_MS)) {
        recentSends.delete(k)
      }
    }
  }
  const kept = (recentSends.get(jid) ?? []).filter((t) => now - t < CONTACT_WINDOW_MS)
  if (kept.length >= CONTACT_CAP) {
    recentSends.set(jid, kept)
    return true
  }
  kept.push(now)
  recentSends.set(jid, kept)
  return false
}

// onInbound é fiado pelo Passo 5 (persistInbound + fila). Aqui só produzimos o evento.
let onInbound: (event: InboundEvent) => void = () => {}
export function setInboundHandler(handler: (event: InboundEvent) => void): void {
  onInbound = handler
}

// makeWASocket injetável — os testes trocam por um socket falso.
type MakeSocket = typeof makeWASocket
let makeSocket: MakeSocket = makeWASocket
let usingRealSocket = true
export function __setMakeSocket(fn: MakeSocket | null): void {
  makeSocket = fn ?? makeWASocket
  usingRealSocket = fn == null
}

// A versão do WhatsApp Web PRECISA ser a atual, senão o WhatsApp RECUSA o
// pareamento ("verifique a rede e tente novamente"). Busca uma vez e cacheia;
// null = deixa o Baileys usar o default (só se a busca falhar). Só busca com o
// socket real (nos testes o socket é falso e não precisa).
let cachedVersion: [number, number, number] | undefined
async function getWaVersion(): Promise<[number, number, number] | undefined> {
  if (cachedVersion) {
    return cachedVersion
  }
  try {
    // fetchLatestWaWebVersion busca em web.whatsapp.com (a fonte real). Se falhar ou vier
    // defasada, o pareamento pode ser recusado — ALARMA (não silencia) e deixa o Baileys
    // cair no default como último recurso.
    // Timeout: web.whatsapp.com lento (DNS/rede) não pode travar o boot-reconnect — corta
    // em 5s e cai no default do Baileys (FU2).
    const { version, isLatest } = await Promise.race([
      fetchLatestWaWebVersion({}),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout ao buscar versão do WA Web')), 5_000),
      ),
    ])
    cachedVersion = version
    if (!isLatest) {
      console.warn('[baileys] versão do WA Web pode estar defasada:', version)
      void reportDegradation('baileys_versao_wa_defasada')
    }
  } catch (error) {
    console.error('[baileys] fetchLatestWaWebVersion falhou; usando default:', error)
    void reportDegradation('baileys_versao_wa_falhou')
  }
  return cachedVersion
}

// biome-ignore lint/suspicious/noExplicitAny: stub do ILogger do pino p/ o socket
const silentLogger: any = {
  level: 'silent',
  child: () => silentLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

// Só dígitos do jid (5511...:12@s.whatsapp.net → 5511...) — casa com o wa_id da Meta.
function jidToMsisdn(jid: string): string {
  return jid.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? ''
}

const UNSUPPORTED_MEDIA_KEYS = [
  'audioMessage',
  'imageMessage',
  'videoMessage',
  'documentMessage',
  'stickerMessage',
] as const

/**
 * Normaliza UMA mensagem do Baileys pro InboundEvent, ou null se deve ser IGNORADA.
 * Função pura (testável) — concentra os filtros defensivos que a verificação exigiu:
 * descarta msg própria (fromMe → laço de auto-resposta), grupo/broadcast, sem corpo,
 * e backlog (timestamp anterior à conexão). Ver §5 Passo 4.
 */
export function normalizeInbound(
  sessionId: string,
  m: WAMessage,
  connectedAtMs: number | null,
): InboundEvent | null {
  if (m.key?.fromMe) {
    return null // a própria resposta do bot volta como upsert — nunca reprocessar
  }
  const remoteJid = m.key?.remoteJid ?? ''
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) {
    return null // grupo/status fora do escopo v1
  }
  if (!m.message) {
    return null // protocolMessage/receipt/vazio
  }
  // Backlog: no connect/reconnect o Baileys entrega mensagens antigas — o dedup por
  // id NÃO segura o que nunca vimos, então cortamos pelo timestamp.
  if (connectedAtMs != null) {
    const tsSec = Number(m.messageTimestamp ?? 0)
    if (tsSec > 0 && tsSec * 1000 < connectedAtMs - REPAIR_GRACE_MS) {
      return null
    }
  }
  const messageId = m.key?.id ?? ''
  const contactId = jidToMsisdn(remoteJid)
  if (!messageId || !contactId) {
    return null
  }
  const base = { channelSessionId: sessionId, contactId, remoteJid, messageId }

  const text = m.message.conversation ?? m.message.extendedTextMessage?.text ?? undefined
  if (text?.trim()) {
    return { ...base, kind: 'text', text }
  }
  const mediaKey = UNSUPPORTED_MEDIA_KEYS.find((k) => k in (m.message ?? {}))
  if (mediaKey) {
    return { ...base, kind: 'unsupported', mediaType: mediaKey.replace('Message', '') }
  }
  return null // reação, edição, etc. — nada a responder
}

async function persist(sessionId: string, data: Record<string, unknown>): Promise<void> {
  await db.channelSession
    .update({ where: { id: sessionId }, data })
    .catch((e) => console.error(`[baileys] persist status falhou (${sessionId}):`, e))
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// Cria o socket de uma sessão e fia os eventos. Idempotente: fecha um socket anterior.
async function connect(sessionId: string, isReconnect = false): Promise<void> {
  if (!isBaileysEnabled()) {
    return
  }
  const existing = sessions.get(sessionId)
  // Re-pareamento sobre uma sessão VIVA é no-op: derrubar um socket ainda ativo dispara
  // tempestade de reconexão (connectionReplaced = sinal de bot). Só um clique externo em
  // "parear" (startPairing) cai aqui; a reconexão interna passa isReconnect=true.
  if (
    existing &&
    !isReconnect &&
    !existing.closing &&
    (existing.status === 'conectado' || existing.status === 'pareando')
  ) {
    return
  }
  if (existing) {
    existing.closing = true
    if (existing.reconnectTimer) {
      clearTimeout(existing.reconnectTimer)
    }
    try {
      existing.sock.end(undefined)
    } catch {}
  }
  // biome-ignore lint/correctness/useHookAtTopLevel: não é hook React — função de servidor que lê o auth-state cifrado
  const auth = await useDbAuthState(sessionId) // lança se auth corrompido → tratado pelo chamador
  // Versão atual do WA Web (só com o socket real; senão o pareamento é recusado).
  const version = usingRealSocket ? await getWaVersion() : undefined

  const sock = makeSocket({
    version,
    auth: auth.state,
    printQRInTerminal: false,
    // Fingerprint de cliente realista: um tuple inventado ('Hermes') vai literal no campo
    // os do DeviceProps e denuncia cliente não-oficial no aparelho vinculado.
    browser: ['Mac OS', 'Chrome', '14.4.1'],
    logger: silentLogger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  })

  const entry: SessionEntry = {
    sock,
    auth,
    status: 'pareando',
    qr: null,
    connectedAtMs: null,
    reconnects: existing?.reconnects ?? 0,
    closing: false,
    sentToday: 0,
    sentDay: today(),
  }
  sessions.set(sessionId, entry)

  sock.ev.on('creds.update', () => auth.saveCreds())

  sock.ev.on('connection.update', (update) => {
    void handleConnectionUpdate(sessionId, sock, update).catch((e) =>
      console.error(`[baileys] connection.update erro (${sessionId}):`, e),
    )
  })

  sock.ev.on('messages.upsert', (upsert) => {
    if (upsert.type !== 'notify') {
      return // 'append' = histórico/backlog; nunca responder
    }
    const cur = sessions.get(sessionId)
    if (!cur || cur.sock !== sock) {
      return // evento de um socket antigo (já substituído) — ignora
    }
    for (const m of upsert.messages) {
      const event = normalizeInbound(sessionId, m, cur?.connectedAtMs ?? null)
      if (event) {
        // Guarda o jid ORIGINAL pra responder a ele (resolve o endereçamento @lid).
        rememberInboundJid(sessionId, event.contactId, event.remoteJid)
        try {
          onInbound(event)
        } catch (e) {
          console.error(`[baileys] onInbound erro (${sessionId}):`, e)
        }
      }
    }
  })
}

async function handleConnectionUpdate(
  sessionId: string,
  thisSock: WASocket,
  // biome-ignore lint/suspicious/noExplicitAny: shape do connection.update do Baileys
  update: any,
): Promise<void> {
  const entry = sessions.get(sessionId)
  if (!entry || entry.sock !== thisSock) {
    return // evento de um socket antigo (já substituído) — ignora, evita churn de reconexão
  }
  const { connection, lastDisconnect, qr } = update

  if (qr) {
    entry.qr = qr
    entry.status = 'pareando'
    await persist(sessionId, { status: 'pareando' })
  }

  if (connection === 'open') {
    entry.status = 'conectado'
    entry.qr = null
    entry.connectedAtMs = Date.now()
    entry.reconnects = 0
    // Persiste o auth AGORA (cancela o debounce): o registro do device recém-pareado fica
    // durável no instante crítico — um restart logo após o scan não força novo QR.
    await entry.auth.flush().catch(() => {})
    const waNumber = entry.sock.user?.id ? jidToMsisdn(entry.sock.user.id) : null
    await persist(sessionId, { status: 'conectado', waNumber, lastConnAt: new Date() })
  }

  if (connection === 'close') {
    if (entry.closing) {
      return // fechamento pedido por nós (disconnect/shutdown)
    }
    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
    const terminal =
      statusCode === DisconnectReason.loggedOut ||
      statusCode === DisconnectReason.connectionReplaced ||
      statusCode === DisconnectReason.badSession ||
      statusCode === DisconnectReason.forbidden
    if (terminal) {
      entry.status = 'derrubado'
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer)
      }
      sessions.delete(sessionId)
      // loggedOut invalida o auth — limpa pra forçar novo QR.
      const clear = statusCode === DisconnectReason.loggedOut ? { authStateEnc: null } : {}
      await persist(sessionId, { status: 'derrubado', ...clear })
      void reportDegradation('baileys_sessao_derrubada')
      return
    }
    // Recuperável (connectionClosed/Lost, restartRequired, timedOut): backoff.
    entry.reconnects += 1
    if (entry.reconnects > MAX_RECONNECTS) {
      entry.status = 'derrubado'
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer)
      }
      sessions.delete(sessionId)
      await persist(sessionId, { status: 'derrubado' })
      void reportDegradation('baileys_reconexao_esgotada')
      return
    }
    // Queda recuperável reflete no status: o painel /canais deixa de mostrar "Conectado"
    // durante a reconexão (senão o dono acha que está no ar). Persiste uma vez só por
    // janela de queda — issue #9 da auditoria de estabilização.
    if (entry.status !== 'reconectando') {
      entry.status = 'reconectando'
      await persist(sessionId, { status: 'reconectando' })
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (entry.reconnects - 1), RECONNECT_CAP_MS)
    const jitter = Math.floor(delay * 0.2 * Math.random())
    entry.reconnectTimer = setTimeout(() => {
      void connect(sessionId, true).catch(async (e) => {
        // Reconexão lançou (ex.: auth corrompido) — não deixa a sessão fantasma dizendo
        // 'reconectando' pra sempre: marca derrubado e alarma (FU2).
        console.error(`[baileys] reconexão falhou (${sessionId}):`, e)
        sessions.delete(sessionId)
        await persist(sessionId, { status: 'derrubado' })
        void reportDegradation('baileys_reconexao_falhou')
      })
    }, delay + jitter)
  }
}

/**
 * Inicia o pareamento de uma sessão (gera o QR). Idempotente. O QR aparece via
 * getSessionView (a tela /canais faz poll). Server-side.
 */
export async function startPairing(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isBaileysEnabled()) {
    return { ok: false, error: 'Canal WhatsApp por QR desligado (BAILEYS_ENABLED).' }
  }
  try {
    await connect(sessionId)
    return { ok: true }
  } catch (error) {
    // auth corrompido (SESSION_SECRET mudou) ou erro ao subir o socket.
    await persist(sessionId, { status: 'derrubado' })
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao iniciar o pareamento.',
    }
  }
}

/** Estado atual da sessão pra tela (status + QR quando pareando). */
export function getSessionView(sessionId: string): { status: string; qr: string | null } {
  const entry = sessions.get(sessionId)
  return { status: entry?.status ?? 'desconectado', qr: entry?.qr ?? null }
}

/**
 * Envia texto por uma sessão Baileys. Nunca lança → devolve `SendResult` (contrato do
 * dispatcher): o retorno deixou de ser `boolean` no T1 da 6C.8B, e este comentário ainda
 * anunciava o contrato antigo.
 *
 * `key.id` é o identificador da mensagem devolvido por uma chamada concluída — ele NÃO prova
 * aceitação remota nem entrega (o spike do T2 teve três `key.id` e zero entregas). É só o que
 * permite, mais tarde, falar sobre esta mensagem em vez de sobre "alguma".
 *
 * Ritmo humano (anti-ban): presence 'composing' + atraso proporcional ao tamanho.
 */
export async function sendText(sessionId: string, to: string, text: string): Promise<SendResult> {
  const entry = sessions.get(sessionId)
  if (entry?.status !== 'conectado') {
    console.warn(`[baileys] envio ignorado — sessão ${sessionId} não conectada`)
    return { status: 'not_sent', retryable: false, reason: 'sessao_desconectada' }
  }
  const jid = resolveReplyJid(sessionId, to)
  if (overContactCap(jid)) {
    console.warn(`[baileys] teto por contato atingido — envio suprimido p/ ${jid}`)
    void reportDegradation('baileys_ping_pong_suprimido')
    return { status: 'not_sent', retryable: false, reason: 'teto_por_contato' }
  }
  try {
    // Teto diário SOFT: só avisa (bloquear deixaria o cliente sem resposta).
    const day = today()
    if (entry.sentDay !== day) {
      entry.sentDay = day
      entry.sentToday = 0
    }
    entry.sentToday += 1
    if (entry.sentToday > DAILY_SOFT_CAP) {
      console.warn(`[baileys] sessão ${sessionId} passou do teto diário (${entry.sentToday})`)
    }
    await entry.sock.sendPresenceUpdate('composing', jid).catch(() => {})
    const delay = Math.min(PACE_MIN_MS + text.length * PACE_PER_CHAR_MS, PACE_MAX_MS)
    await new Promise((r) => setTimeout(r, delay))
    // O comprovante do Baileys é o `key.id` da mensagem devolvida. Ele era descartado.
    const enviada = await entry.sock.sendMessage(jid, { text })

    // A presença ("digitando…"/"parou") é COSMÉTICA e vem DEPOIS do envio. O `.catch` já
    // existia, e a razão dele fica registrada: uma falha aqui não pode transformar uma
    // mensagem comprovadamente entregue em ambígua — isso levaria o sistema a parar e pedir
    // reconciliação humana por causa de um indicador de digitação.
    await entry.sock.sendPresenceUpdate('paused', jid).catch(() => {})

    const id = (enviada as { key?: { id?: unknown } } | null | undefined)?.key?.id
    if (typeof id !== 'string' || id.length === 0) {
      console.error('[baileys] envio sem comprovante (key.id) — tratando como ambíguo')
      return { status: 'ambiguous', reason: 'sem_comprovante' }
    }
    return { status: 'sent', providerMessageId: id }
  } catch (error) {
    // O socket pode ter transmitido antes de cair. Do lado de cá é indistinguível.
    console.error(
      `[baileys] erro no envio (${sessionId}):`,
      error instanceof Error ? error.message : error,
    )
    return { status: 'ambiguous', reason: 'falha_no_socket' }
  }
}

/** Desconecta uma sessão. logout=true invalida o auth (pede novo QR); senão preserva. */
export async function disconnect(sessionId: string, logout = false): Promise<void> {
  const entry = sessions.get(sessionId)
  if (!entry) {
    return
  }
  entry.closing = true
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer)
  }
  try {
    if (logout) {
      await entry.sock.logout().catch(() => {})
      await persist(sessionId, { status: 'desconectado', authStateEnc: null })
    } else {
      await entry.auth.flush().catch(() => {})
      entry.sock.end(undefined)
      await persist(sessionId, { status: 'desconectado' })
    }
  } finally {
    sessions.delete(sessionId)
  }
}

/** Fecha TODOS os sockets no shutdown (sem logout — preserva o auth p/ reconectar). */
export async function closeAllSockets(): Promise<void> {
  const entries = [...sessions.entries()]
  await Promise.all(
    entries.map(async ([id, entry]) => {
      entry.closing = true
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer)
      }
      await entry.auth.flush().catch(() => {})
      try {
        entry.sock.end(undefined)
      } catch {}
      sessions.delete(id)
    }),
  )
}

/**
 * Reconecta no boot as sessões que estavam ativas (lazy — só é chamado se há ao menos
 * uma). Inclui 'reconectando': o reconnectTimer é em memória e se perde no restart, então
 * uma sessão que caiu na janela de backoff DEVE ser retomada aqui, senão fica órfã pra
 * sempre. Cada uma isolada: uma sessão ruim NUNCA derruba o boot. Server-side.
 */
export async function reconnectActiveSessions(): Promise<void> {
  if (!isBaileysEnabled()) {
    return
  }
  const rows = await db.channelSession.findMany({
    where: { kind: 'baileys', status: { in: ['conectado', 'reconectando'] } },
    select: { id: true },
  })
  for (const row of rows) {
    try {
      await connect(row.id, true)
    } catch (error) {
      console.error(`[baileys] boot-reconnect falhou (${row.id}):`, error)
      await persist(row.id, { status: 'derrubado' })
    }
  }
}

// Só p/ teste: limpa o registro em memória entre casos.
export function __resetSessions(): void {
  sessions.clear()
  jidByContact.clear()
  recentSends.clear()
}
