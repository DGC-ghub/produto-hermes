// O QUE O TRACE DIZ QUANDO A IA PERDE A CONVERSA.
//
// `human_handling` cobria três fenômenos diferentes, e a confusão custava caro:
//
//   - o humano JÁ conduzia quando a mensagem chegou — o motor nem gastou cérebro;
//   - o humano assumiu no MEIO do raciocínio — uma resposta de dezenas de segundos e do
//     dinheiro do provider, jogada fora;
//   - a conversa foi encerrada ou apagada — humano nenhum assumiu coisa alguma.
//
// O segundo é o número que diz se o corretivo de concorrência funcionou, e ele era
// indistinguível do primeiro. A fase sai de `brainMs`, não de mais um outcome:
//
//   WHERE outcome = 'human_took_over' AND brainMs IS NOT NULL
//
// O provider também parou de ser inferido do desfecho: era derivado de `ok`/`fallback`, então
// uma tomada pós-cérebro aparecia como `provider: 'nenhum'`, como se nada tivesse sido gasto.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import type { AttendantOutput } from './attendant/types'

const cerebro = vi.hoisted(() => {
  function barreira() {
    let abrir: () => void = () => {}
    const esperar = new Promise<void>((resolver) => {
      abrir = resolver
    })
    return { esperar, abrir }
  }
  return {
    barreira,
    entrou: barreira(),
    liberar: barreira(),
    chamadas: 0,
    reiniciar() {
      this.entrou = barreira()
      this.liberar = barreira()
      this.chamadas = 0
    },
  }
})

const SAIDA: AttendantOutput = {
  reply: 'Claro, posso ajudar com isso.',
  needsHuman: false,
  handoffReason: null,
  leadPatch: null,
  confidence: 0.9,
  action: null,
}

vi.mock('./alarm.server', () => ({
  reportDegradation: vi.fn(),
  reportSensitiveHandoff: vi.fn(),
}))

// Barreira na base de conhecimento: é o único ponto de espera do caminho do GUARD, que
// decide sozinho e não chama o cérebro.
const base = vi.hoisted(() => ({
  pausa: null as Promise<void> | null,
  entrou: null as { esperar: Promise<void>; abrir: () => void } | null,
}))

vi.mock('./knowledge-db.server', () => ({
  resolveKnowledge: async () => {
    base.entrou?.abrir()
    if (base.pausa) await base.pausa
    return [
      {
        tenantSlug: 'dgc',
        fileName: 'base.md',
        title: 'Base',
        content: 'Atendemos das 9h às 18h.',
      },
    ]
  },
}))

vi.mock('./attendant/providers/mock', () => ({
  mockProvider: {
    name: 'mock',
    generate: async (): Promise<AttendantOutput> => {
      cerebro.chamadas += 1
      cerebro.entrou.abrir()
      await cerebro.liberar.esperar
      return SAIDA
    },
  },
}))

const { processIncomingMessage } = await import('./conversation.server')
const { reportSensitiveHandoff } = await import('./alarm.server')

const CONTATO = 'test-telemetria-autoridade'
let conversaId: string

/** A gravação é disparada sem await (fora do caminho crítico) — esperamos ela pousar. */
async function traceDa(conversationId: string) {
  return vi.waitFor(
    async () => {
      const trace = await db.messageTrace.findFirst({ where: { conversationId } })
      if (!trace) throw new Error('trace ainda não gravado')
      return trace
    },
    { timeout: 3000, interval: 25 },
  )
}

/** Roda o motor e muda o status da conversa enquanto o cérebro está parado na barreira. */
async function comMudancaDuranteOCerebro(mudar: () => Promise<void>) {
  const processamento = processIncomingMessage({
    tenantSlug: 'dgc',
    message: 'consigo remarcar meu horário?',
    contactId: CONTATO,
    mode: 'whatsapp',
  })
  await cerebro.entrou.esperar
  await mudar()
  cerebro.liberar.abrir()
  return processamento
}

beforeEach(async () => {
  cerebro.reiniciar()
  base.pausa = null
  base.entrou = null
  vi.clearAllMocks()
  const tenant = await db.tenant.upsert({
    where: { slug: 'dgc' },
    update: {},
    create: { slug: 'dgc', name: 'DGC Hub' },
  })
  conversaId = (
    await db.conversation.create({
      data: { tenantId: tenant.id, contactId: CONTATO, channel: 'whatsapp', status: 'open' },
    })
  ).id
})

afterEach(async () => {
  await db.messageTrace.deleteMany({ where: { conversationId: conversaId } })
  await db.ticket.deleteMany({ where: { contactId: CONTATO } })
  await db.handoffEvent.deleteMany({ where: { conversationId: conversaId } })
  await db.lead.deleteMany({ where: { conversationId: conversaId } })
  await db.message.deleteMany({ where: { conversationId: conversaId } })
  await db.conversation.deleteMany({ where: { id: conversaId } })
})

describe('o trace distingue os motivos de perder a conversa', () => {
  it('humano JÁ conduzia na entrada: sem cérebro, sem provider', async () => {
    await db.conversation.update({ where: { id: conversaId }, data: { status: 'human' } })

    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    expect(r.humanHandling).toBe(true)
    expect(cerebro.chamadas).toBe(0)

    const trace = await traceDa(conversaId)
    expect(trace.outcome).toBe('human_at_entry')
    expect(trace.provider).toBe('nenhum')
    expect(trace.brainMs).toBeNull()
  })

  it('humano assumiu DEPOIS do cérebro: o consumo aparece no trace', async () => {
    // O caso caro. Antes ele era indistinguível do de cima — mesmo outcome, e `provider`
    // apagado para 'nenhum' porque era derivado do desfecho.
    const r = await comMudancaDuranteOCerebro(() =>
      db.conversation
        .update({ where: { id: conversaId }, data: { status: 'human' } })
        .then(() => undefined),
    )

    expect(r.humanHandling).toBe(true)
    expect(r.reply).toBe('')
    expect(cerebro.chamadas).toBe(1)

    const trace = await traceDa(conversaId)
    expect(trace.outcome).toBe('human_took_over')
    expect(trace.provider).toBe('mock')
    expect(trace.brainMs).not.toBeNull()
  })

  it('conversa ENCERRADA durante o cérebro: não diz que um humano assumiu', async () => {
    const r = await comMudancaDuranteOCerebro(() =>
      db.conversation
        .update({ where: { id: conversaId }, data: { status: 'closed' } })
        .then(() => undefined),
    )

    // Ninguém assumiu nada: marcar `humanHandling` aqui colocaria uma conversa encerrada na
    // fila do operador.
    expect(r.humanHandling).toBe(false)
    expect(r.needsHuman).toBe(false)
    expect(r.handoffReason).toBe('conversation_closed')
    expect(r.reply).toBe('')

    const trace = await traceDa(conversaId)
    expect(trace.outcome).toBe('conversation_closed')
    expect(trace.provider).toBe('mock')
    expect(trace.brainMs).not.toBeNull()
  })

  it('status DESCONHECIDO: silêncio fail-closed, e o trace diz isso', async () => {
    // Um status que a allowlist não conhece — o que acontece no dia em que alguém adiciona
    // um estado novo e esquece do CAS. O motor se cala em vez de assumir que pode escrever.
    const r = await comMudancaDuranteOCerebro(() =>
      db.conversation
        .update({ where: { id: conversaId }, data: { status: 'em_ferias' } })
        .then(() => undefined),
    )

    expect(r.humanHandling).toBe(false)
    expect(r.handoffReason).toBe('authority_lost')
    expect(r.reply).toBe('')

    const trace = await traceDa(conversaId)
    expect(trace.outcome).toBe('authority_lost_unknown')
  })

  it('conversa APAGADA durante o cérebro: o trace ainda é gravado', async () => {
    const r = await comMudancaDuranteOCerebro(async () => {
      await db.message.deleteMany({ where: { conversationId: conversaId } })
      await db.conversation.delete({ where: { id: conversaId } })
    })

    expect(r.humanHandling).toBe(false)
    expect(r.handoffReason).toBe('conversation_missing')
    expect(r.reply).toBe('')
    // A conversa sumiu, e as mensagens dela com ela: devolver o id de uma linha apagada é
    // pior que não devolver nada — quem recebe trata `userMessageId` como handle persistido.
    expect(r.userMessageId).toBe('')

    // `MessageTrace.conversationId` não tem FK para `Conversation`, então a medição sobrevive
    // ao sumiço da conversa — e é justamente aí que ela é mais útil.
    const trace = await traceDa(conversaId)
    expect(trace.outcome).toBe('conversation_missing')
    expect(trace.provider).toBe('mock')
  })

  it('no caminho do GUARD, o motivo também é classificado', async () => {
    // O guard é outro ponto de perda, com outra transação. Sem este teste, fixar o motivo em
    // 'human' ali sobrevive: as provas acima atravessam só o caminho do cérebro.
    base.entrou = cerebro.barreira()
    const liberar = cerebro.barreira()
    base.pausa = liberar.esperar

    const processamento = processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'preciso falar sobre o contrato e meus dados pessoais',
      contactId: CONTATO,
      mode: 'whatsapp',
    })
    await base.entrou.esperar
    await db.conversation.update({ where: { id: conversaId }, data: { status: 'closed' } })
    liberar.abrir()
    const r = await processamento

    expect(cerebro.chamadas).toBe(0)
    expect(r.humanHandling).toBe(false)
    expect(r.handoffReason).toBe('conversation_closed')

    const trace = await traceDa(conversaId)
    expect(trace.outcome).toBe('conversation_closed')
    // O guard decide sozinho: nenhum provider foi consumido.
    expect(trace.provider).toBe('nenhum')
    expect(trace.brainMs).toBeNull()
  })

  it('o par positivo: sem mudança, o trace continua dizendo ok', async () => {
    // Sem este, classificar tudo como perda ficaria verde nos quatro de cima.
    const r = await comMudancaDuranteOCerebro(async () => {})

    expect(r.reply).toBe(SAIDA.reply)
    const trace = await traceDa(conversaId)
    expect(trace.outcome).toBe('ok')
    expect(trace.provider).toBe('mock')
    expect(trace.brainMs).not.toBeNull()
  })
})

describe('o alarme sensível só toca depois da autorização vencer', () => {
  /** Tema sensível: o guard decide sozinho, sem passar pelo cérebro. */
  const SENSIVEL = 'preciso falar sobre o contrato e meus dados pessoais'

  it('CAS perdido: nenhum push para um operador que JÁ está na conversa', async () => {
    base.entrou = cerebro.barreira()
    const liberar = cerebro.barreira()
    base.pausa = liberar.esperar

    const processamento = processIncomingMessage({
      tenantSlug: 'dgc',
      message: SENSIVEL,
      contactId: CONTATO,
      mode: 'whatsapp',
    })
    await base.entrou.esperar
    await db.conversation.update({ where: { id: conversaId }, data: { status: 'human' } })
    liberar.abrir()
    await processamento

    // Avisar "escalação sensível" a quem já está atendendo é alarmar sobre algo que não
    // aconteceu — e alarme que mente é alarme que se aprende a ignorar.
    expect(reportSensitiveHandoff).not.toHaveBeenCalled()
  })

  it('contenção na persistência: o alarme toca UMA vez, depois do commit', async () => {
    // O retry repete a transação; o alarme fica FORA dela, e por isso não se repete junto.
    const real = db.$transaction.bind(db) as (a: unknown, b: unknown) => Promise<unknown>
    let tentativas = 0
    vi.spyOn(db, '$transaction').mockImplementation((async (fn: unknown, opcoes: unknown) => {
      tentativas += 1
      if (tentativas === 1) {
        await real(async (tx: unknown) => {
          await (fn as (t: unknown) => Promise<unknown>)(tx)
          throw new Error('SQLITE_BUSY: database is locked')
        }, opcoes)
      }
      return real(fn, opcoes)
    }) as typeof db.$transaction)

    await processIncomingMessage({
      tenantSlug: 'dgc',
      message: SENSIVEL,
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    expect(tentativas).toBeGreaterThan(1)
    expect(reportSensitiveHandoff).toHaveBeenCalledTimes(1)
  })
})
