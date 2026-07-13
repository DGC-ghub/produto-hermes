import { Boom } from '@hapi/boom'
import { DisconnectReason } from '@whiskeysockets/baileys'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../db.server', () => ({
  db: {
    channelSession: {
      findUnique: vi.fn(async () => ({ authStateEnc: null })),
      update: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    },
  },
}))
vi.mock('../alarm.server', () => ({ reportDegradation: vi.fn() }))

import { db } from '../../db.server'
import {
  __resetSessions,
  __setMakeSocket,
  disconnect,
  getSessionView,
  normalizeInbound,
  overContactCap,
  reconnectActiveSessions,
  sendText,
  setInboundHandler,
  startPairing,
} from './baileys.server'

const tick = () => new Promise((r) => setTimeout(r, 5))
const nowSec = () => Math.floor(Date.now() / 1000)

// Socket falso: guarda os handlers e deixa o teste dispará-los via _emit.
function makeFakeSock() {
  const handlers: Record<string, (arg: unknown) => void> = {}
  return {
    _emit: (event: string, arg: unknown) => handlers[event]?.(arg),
    ev: { on: (event: string, cb: (arg: unknown) => void) => (handlers[event] = cb) },
    user: { id: '5511988887777:12@s.whatsapp.net' },
    sendMessage: vi.fn(async () => ({})),
    sendPresenceUpdate: vi.fn(async () => {}),
    presenceSubscribe: vi.fn(async () => {}),
    end: vi.fn(),
    logout: vi.fn(async () => {}),
  }
}

function textMsg(from: string, body: string, tsSec = nowSec()) {
  return {
    key: { remoteJid: `${from}@s.whatsapp.net`, fromMe: false, id: `m-${body}` },
    message: { conversation: body },
    messageTimestamp: tsSec,
  }
}

describe('normalizeInbound (filtros defensivos)', () => {
  it('descarta a própria mensagem (fromMe) — anti-laço', () => {
    const m = {
      key: { remoteJid: '5511@s.whatsapp.net', fromMe: true, id: 'x' },
      message: { conversation: 'oi' },
      messageTimestamp: nowSec(),
    }
    expect(normalizeInbound('s1', m as never, null)).toBeNull()
  })
  it('descarta grupo (@g.us) e broadcast', () => {
    const g = {
      key: { remoteJid: '123@g.us', fromMe: false, id: 'x' },
      message: { conversation: 'oi' },
    }
    expect(normalizeInbound('s1', g as never, null)).toBeNull()
  })
  it('descarta mensagem sem corpo (protocol/receipt)', () => {
    const m = { key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'x' }, message: null }
    expect(normalizeInbound('s1', m as never, null)).toBeNull()
  })
  it('descarta backlog (timestamp anterior à conexão)', () => {
    const old = nowSec() - 3600
    const m = textMsg('5511988887777', 'antiga', old)
    expect(normalizeInbound('s1', m as never, Date.now())).toBeNull()
  })
  it('texto vira InboundEvent com contactId em MSISDN e o remoteJid original', () => {
    const e = normalizeInbound('s1', textMsg('5511988887777', 'geladeira parou') as never, null)
    expect(e).toMatchObject({
      channelSessionId: 's1',
      contactId: '5511988887777',
      remoteJid: '5511988887777@s.whatsapp.net',
      kind: 'text',
      text: 'geladeira parou',
    })
  })
  it('áudio/mídia vira kind unsupported com o mediaType', () => {
    const m = {
      key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false, id: 'x' },
      message: { audioMessage: {} },
      messageTimestamp: nowSec(),
    }
    expect(normalizeInbound('s1', m as never, null)).toMatchObject({
      kind: 'unsupported',
      mediaType: 'audio',
    })
  })
})

describe('gerente Baileys (ciclo de vida)', () => {
  let fake: ReturnType<typeof makeFakeSock>
  beforeEach(() => {
    process.env.BAILEYS_ENABLED = '1'
    fake = makeFakeSock()
    __setMakeSocket((() => fake) as never)
  })
  afterEach(() => {
    __resetSessions()
    __setMakeSocket(null)
    delete process.env.BAILEYS_ENABLED
    vi.clearAllMocks()
  })

  it('pareamento → QR → conectado; e inbound filtra própria/append', async () => {
    const inbound = vi.fn()
    setInboundHandler(inbound)
    const r = await startPairing('s1')
    expect(r.ok).toBe(true)

    fake._emit('connection.update', { qr: 'QR-ABC' })
    await tick()
    expect(getSessionView('s1')).toEqual({ status: 'pareando', qr: 'QR-ABC' })

    fake._emit('connection.update', { connection: 'open' })
    await tick()
    expect(getSessionView('s1').status).toBe('conectado')

    // notify com texto do cliente → entrega
    fake._emit('messages.upsert', { type: 'notify', messages: [textMsg('5511988887777', 'oi')] })
    expect(inbound).toHaveBeenCalledTimes(1)
    expect(inbound.mock.calls[0][0]).toMatchObject({ text: 'oi', contactId: '5511988887777' })

    // append (histórico) → ignora
    fake._emit('messages.upsert', { type: 'append', messages: [textMsg('5511988887777', 'velha')] })
    // fromMe → ignora
    fake._emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: true, id: 'z' },
          message: { conversation: 'eco' },
          messageTimestamp: nowSec(),
        },
      ],
    })
    expect(inbound).toHaveBeenCalledTimes(1)
  })

  it('sendText só envia quando conectado, com o jid certo', async () => {
    await startPairing('s2')
    // ainda não conectou → false
    expect(await sendText('s2', '5511988887777', 'oi')).toBe(false)

    fake._emit('connection.update', { connection: 'open' })
    await tick()
    const ok = await sendText('s2', '5511988887777', 'pronto')
    expect(ok).toBe(true)
    expect(fake.sendMessage).toHaveBeenCalledWith('5511988887777@s.whatsapp.net', {
      text: 'pronto',
    })
  })

  it('responde ao remoteJid @lid original, não aos dígitos reconstruídos', async () => {
    // O WhatsApp novo entrega de um jid @lid (número oculto). Se responder aos dígitos
    // reconstruídos (<lid>@s.whatsapp.net), a resposta vai pro vácuo. Deve responder ao
    // jid @lid ORIGINAL, lembrado da entrada.
    const inbound = vi.fn()
    setInboundHandler(inbound)
    await startPairing('s5')
    fake._emit('connection.update', { connection: 'open' })
    await tick()

    const lid = '183709290479830'
    fake._emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: `${lid}@lid`, fromMe: false, id: 'm-lid' },
          message: { conversation: 'oi' },
          messageTimestamp: nowSec(),
        },
      ],
    })
    expect(inbound.mock.calls[0][0]).toMatchObject({ contactId: lid, remoteJid: `${lid}@lid` })

    // o motor responde passando o contactId (só dígitos) → deve sair pro @lid original
    const ok = await sendText('s5', lid, 'pronto')
    expect(ok).toBe(true)
    expect(fake.sendMessage).toHaveBeenCalledWith(`${lid}@lid`, { text: 'pronto' })
  })

  it('re-pareamento sobre sessão viva é no-op e usa fingerprint realista (H1/H5)', async () => {
    const spy = vi.fn((..._args: unknown[]) => fake)
    __setMakeSocket(spy as never)
    await startPairing('s6')
    fake._emit('connection.update', { connection: 'open' })
    await tick()
    expect(getSessionView('s6').status).toBe('conectado')
    // fingerprint realista (não 'Hermes', que denuncia cliente não-oficial)
    expect(spy.mock.calls[0][0]).toMatchObject({ browser: ['Mac OS', 'Chrome', '14.4.1'] })
    // segundo clique em 'parear' com a sessão VIVA → no-op: não recria socket nem derruba
    const r = await startPairing('s6')
    expect(r.ok).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(fake.end).not.toHaveBeenCalled()
  })

  it('teto por contato suprime após o limite (H4 anti-ping-pong)', () => {
    const jid = '5511999990000@s.whatsapp.net'
    let suppressed = 0
    for (let i = 0; i < 15; i++) {
      if (overContactCap(jid)) suppressed++
    }
    // CONTACT_CAP=12 passam; os 3 seguintes são suprimidos (quebra o loop de bots)
    expect(suppressed).toBe(3)
  })

  it('queda recuperável marca status reconectando (#9)', async () => {
    await startPairing('s-recon')
    fake._emit('connection.update', { connection: 'open' })
    await tick()
    expect(getSessionView('s-recon').status).toBe('conectado')
    // close NÃO-terminal (connectionLost) → agenda reconexão e marca 'reconectando'
    fake._emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: new Boom('lost', { statusCode: DisconnectReason.connectionLost }) },
    })
    await tick()
    expect(getSessionView('s-recon').status).toBe('reconectando')
    await disconnect('s-recon') // limpa o reconnectTimer pendente (não vaza pro próximo teste)
  })

  it('boot-reconnect retoma sessões reconectando, não só conectado (fix da regressão)', async () => {
    const spy = vi.fn((..._a: unknown[]) => fake)
    __setMakeSocket(spy as never)
    // O reconnectTimer é em memória e se perde no restart: uma sessão que caiu na janela
    // de backoff fica 'reconectando' no banco — o boot DEVE retomá-la (senão fica órfã).
    vi.mocked(db.channelSession.findMany).mockResolvedValueOnce([{ id: 's-boot' }] as never)
    await reconnectActiveSessions()
    expect(spy).toHaveBeenCalledTimes(1) // tentou reconectar (connect → makeSocket)
    const arg = vi.mocked(db.channelSession.findMany).mock.calls[0][0] as {
      where?: { status?: { in?: string[] } }
    }
    expect(arg.where?.status?.in).toEqual(['conectado', 'reconectando'])
    await disconnect('s-boot')
  })

  it('close com loggedOut = derrubado, sem reconectar', async () => {
    await startPairing('s3')
    fake._emit('connection.update', { connection: 'open' })
    await tick()
    fake._emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: new Boom('logged out', { statusCode: DisconnectReason.loggedOut }) },
    })
    await tick()
    expect(getSessionView('s3').status).toBe('desconectado') // removida do mapa → default
  })

  it('não pareia com BAILEYS_ENABLED desligado', async () => {
    delete process.env.BAILEYS_ENABLED
    const r = await startPairing('s4')
    expect(r.ok).toBe(false)
  })
})
