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
    // O dublê devolve o `key.id` como o Baileys real: é o IDENTIFICADOR de uma chamada
    // concluída — não prova aceitação remota nem entrega —, e sem ele o resultado é ambíguo
    // (por desenho, não por bug do teste).
    //
    // E ele ECOA o `messageId` recebido, porque é o que a biblioteca instalada faz:
    // `messages-send.js:1086` monta `{ messageId: generateMessageIDV2(...), ...options }`, e o
    // espalhamento vem DEPOIS — um id fornecido prevalece. Um dublê que ignorasse o id pedido
    // deixaria o adapter livre para aceitar qualquer identificador de volta, que é exatamente a
    // divergência provada logo abaixo (caso 22).
    sendMessage: vi.fn(
      async (_jid: string, _content: unknown, options?: { messageId?: string }) => ({
        key: { id: options?.messageId ?? 'BAE5F1A2B3C4D5E6' },
      }),
    ),
    sendPresenceUpdate: vi.fn(async (_estado: string, _jid?: string) => {}),
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
  // Aqui o jid é `@s.whatsapp.net`, e só AÍ os dígitos do `contactId` são mesmo um telefone.
  // Em `@lid` o mesmo campo é identificador opaco — ver o teste do `@lid` mais abaixo.
  it('texto vira InboundEvent com os dígitos do jid @s.whatsapp.net e o remoteJid original', () => {
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
    // ainda não conectou → não enviado, e nada saiu (seguro tentar depois)
    expect((await sendText('s2', '5511988887777', 'oi')).status).toBe('not_sent')

    fake._emit('connection.update', { connection: 'open' })
    await tick()
    const r = await sendText('s2', '5511988887777', 'pronto')
    expect(r.status).toBe('sent')
    expect(r.status === 'sent' && r.providerMessageId).toBe('BAE5F1A2B3C4D5E6')
    expect(fake.sendMessage).toHaveBeenCalledWith('5511988887777@s.whatsapp.net', {
      text: 'pronto',
    })
  })

  it('10. falha só na presença NÃO apaga um envio já confirmado', async () => {
    // `sendPresenceUpdate('paused')` é cosmético e roda DEPOIS do envio. Se uma falha ali
    // virasse `ambiguous`, o sistema pararia e pediria reconciliação humana por causa de um
    // indicador de "digitando…" — sobre uma mensagem que o cliente já recebeu.
    await startPairing('s9')
    fake._emit('connection.update', { connection: 'open' })
    await tick()

    fake.sendPresenceUpdate.mockImplementation(async (estado: string, _jid?: string) => {
      if (estado === 'paused') {
        throw new Error('socket ocupado')
      }
    })

    const r = await sendText('s9', '5511988887777', 'pronto')

    expect(r.status).toBe('sent')
    expect(fake.sendMessage).toHaveBeenCalled()
  })

  // OS DESFECHOS DO BAILEYS QUE NÃO TINHAM PROVA PRÓPRIA.
  //
  // O T1 implementou os três corretamente, e nenhum era verificado: a suíte só exercitava o
  // caminho feliz e a sessão desconectada. É exatamente a lição registrada no próprio T1 — um
  // caminho sem prova própria não fica protegido por estar perto de outro que tem.
  //
  // O `catch` é o mais caro dos três. Mutá-lo para `not_sent` retentável faria o retry da fila
  // reenviar sobre um socket que PODE ter transmitido — a duplicação no cliente que o T1
  // inteiro existe para eliminar — e, até estes testes, a suíte permanecia verde.

  it('17. `sendMessage` sem `key.id` é AMBÍGUO, não enviado-com-sucesso', async () => {
    // Simétrico ao caso 6 do canal Meta (200 sem `wamid`). Sem identificador não há como saber
    // depois o que aconteceu com esta mensagem, e `sent` sem id recriaria dentro do tipo a
    // ambiguidade que ele elimina.
    await startPairing('s10')
    fake._emit('connection.update', { connection: 'open' })
    await tick()
    fake.sendMessage.mockResolvedValueOnce({} as never)

    const r = await sendText('s10', '5511988887777', 'pronto')

    expect(r.status).toBe('ambiguous')
  })

  it('18. `sendMessage` lançando é AMBÍGUO — o socket pode ter transmitido antes de cair', async () => {
    await startPairing('s11')
    fake._emit('connection.update', { connection: 'open' })
    await tick()
    fake.sendMessage.mockRejectedValueOnce(new Error('Connection Closed'))

    const r = await sendText('s11', '5511988887777', 'pronto')

    expect(r.status).toBe('ambiguous')
    // E não `not_sent`: sob `not_sent` retentável a fila reenviaria, e o cliente receberia duas.
    expect(r.status === 'not_sent').toBe(false)
  })

  it('19. teto por contato é NÃO ENVIADO definitivo — e nada chega ao socket', async () => {
    // O teto é decidido AQUI, antes do socket: nada saiu, então reenviar depois é seguro — mas
    // não adianta insistir agora, e por isso `retryable: false`. O teste anterior exercitava só
    // a função pura `overContactCap`; o desfecho de `sendText` não tinha prova.
    await startPairing('s12')
    fake._emit('connection.update', { connection: 'open' })
    await tick()
    const numero = '5511900000019'
    // CONTACT_CAP = 12 envios na janela; o 13º é suprimido.
    for (let i = 0; i < 12; i++) {
      await sendText('s12', numero, `msg ${i}`)
    }
    fake.sendMessage.mockClear()

    const r = await sendText('s12', numero, 'a que estoura o teto')

    expect(r.status).toBe('not_sent')
    expect(r.status === 'not_sent' && r.retryable).toBe(false)
    expect(fake.sendMessage).not.toHaveBeenCalled()
  })

  // O ID DO ENVIO ESCOLHIDO POR NÓS (6C.8B T3a).
  //
  // Quem escolhia o identificador era a biblioteca, e nós só ficávamos sabendo DEPOIS. Aqui o
  // caminho interno passa a poder fornecê-lo. Sozinho isso não muda nada visível — é o
  // encanamento de que o T3b vai precisar para repetir um envio em dúvida sem o cliente receber
  // duas vezes. A prova tem que estar no ARGUMENTO que chega ao `sendMessage`: o retorno não
  // distingue "encaminhou o id" de "aceitou o id e ignorou".

  it('20. o id fornecido é encaminhado ao `sendMessage` como `messageId`', async () => {
    await startPairing('s13')
    fake._emit('connection.update', { connection: 'open' })
    await tick()

    // O valor é o que `deriveOutboundMessageId('evt_t3a_golden', 'reply')` produz — aqui ele é
    // literal de propósito: este teste prova o ENCAMINHAMENTO, não a derivação (que tem prova
    // própria em outbound-id.test.ts).
    const id = '3EB0A24914DB390B1E3284A44DF34E62313E91AE'
    await sendText('s13', '5511988887777', 'pronto', { outboundMessageId: id })

    expect(fake.sendMessage).toHaveBeenCalledWith(
      '5511988887777@s.whatsapp.net',
      { text: 'pronto' },
      { messageId: id },
    )
  })

  it('22. identificador DEVOLVIDO diferente do solicitado é AMBÍGUO, não sucesso', async () => {
    // A lacuna que a revisão achou: o adapter provava que o id SAI no terceiro argumento, e
    // aceitava de volta qualquer `key.id`. Ficava possível concluir com `sent(Y)` uma chamada
    // feita com X — e o T3b, que vai reusar o identificador para repetir um envio depois de um
    // crash, estaria falando de uma mensagem que não é a que existe do outro lado.
    //
    // Na biblioteca instalada (`messages-send.js:1086`) um `messageId` fornecido PREVALECE.
    // Divergir dali é comportamento inesperado, não sucesso seguro — e como o socket já foi
    // chamado, o desfecho externo é incerto: `ambiguous`, nunca `not_sent`.
    await startPairing('s15')
    fake._emit('connection.update', { connection: 'open' })
    await tick()
    const solicitado = '3EB0A24914DB390B1E3284A44DF34E62313E91AE'
    fake.sendMessage.mockResolvedValueOnce({
      key: { id: '3EB0FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF' },
    } as never)

    const r = await sendText('s15', '5511988887777', 'pronto', {
      outboundMessageId: solicitado,
    })

    expect(r.status).toBe('ambiguous')
    expect(r.status === 'ambiguous' && r.reason).toBe('identificador_divergente')
    // E o identificador solicitado NÃO pode ser devolvido como se fosse o do provedor: a
    // divergência tem que ficar visível, não maquiada.
    expect(r.status === 'sent').toBe(false)
  })

  it('23. par positivo — identificador devolvido IGUAL ao solicitado conclui com ele', async () => {
    // Sem este par, recusar tudo passaria no caso 22 e o canal QR nunca mais concluiria um envio.
    await startPairing('s16')
    fake._emit('connection.update', { connection: 'open' })
    await tick()
    const solicitado = '3EB0A24914DB390B1E3284A44DF34E62313E91AE'

    const r = await sendText('s16', '5511988887777', 'pronto', {
      outboundMessageId: solicitado,
    })

    expect(r.status).toBe('sent')
    expect(r.status === 'sent' && r.providerMessageId).toBe(solicitado)
  })

  it('21. SEM id fornecido o envio segue como hoje — a biblioteca escolhe', async () => {
    // O T3a não pode tornar o parâmetro obrigatório: o operator-reply continua chamando sem id
    // (ação do operador, sem `WebhookEvent` de origem), e um terceiro argumento `undefined` aqui
    // seria uma mudança de contrato sem necessidade.
    await startPairing('s14')
    fake._emit('connection.update', { connection: 'open' })
    await tick()

    const r = await sendText('s14', '5511988887777', 'pronto')

    expect(r.status).toBe('sent')
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
    const r = await sendText('s5', lid, 'pronto')
    expect(r.status).toBe('sent')
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
