// RETRY LOCAL DA PERSISTÊNCIA FINAL.
//
// Quando a transação final falha, `processIncomingMessage` lança. Na fila, o `catch` do
// `drainBatch` devolve o evento para `pending` e o próximo dreno chama o motor DO ZERO — e
// como a fala do cliente é gravada fora de qualquer transação, antes do cérebro, cada
// reexecução:
//
//   1. duplica a mensagem `user` na conversa (o atendente vê a pessoa falando duas vezes);
//   2. paga o cérebro de novo (dezenas de segundos e custo, para produzir a mesma resposta);
//   3. reabre a janela de corrida com o operador.
//
// E o gatilho mais provável dessa falha é justamente contenção do arquivo SQLite — algo que
// costuma passar na segunda tentativa, milissegundos depois. Repetir a TRANSAÇÃO é seguro
// porque ela é atômica: se falhou, nada foi commitado, e a nova tentativa parte do mesmo
// estado. Repetir o FLUXO INTEIRO é que não é.
//
// Este teste não cobre a idempotência durável do WebhookEvent (evento reprocessado depois de
// um restart) — isso é outro problema, com outra solução, e fica para uma tarefa própria.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import type { AttendantOutput } from './attendant/types'

/**
 * Saída que causa TODOS os efeitos: chamado, lead e escalação.
 *
 * Uma versão anterior deste teste usava uma resposta sem efeito nenhum e provava só que a
 * mensagem do cliente e a do assistente não duplicavam. Com isso, um refactor que tirasse
 * lead/chamado/handoff de dentro da transação — e portanto os duplicasse a cada tentativa —
 * passaria batido. Se os efeitos estão na transação, eles têm que sair UMA vez.
 */
const SAIDA: AttendantOutput = {
  reply: 'Pronto, já registrei seu chamado.',
  needsHuman: true,
  handoffReason: 'caso_complexo',
  leadPatch: { name: 'Maria' },
  confidence: 0.8,
  action: {
    type: 'abrir_chamado',
    subject: 'troca de plantao',
    description: 'cliente pediu troca de plantao',
  },
}

vi.mock('./attendant/providers/mock', () => ({
  mockProvider: {
    name: 'mock',
    generate: async (): Promise<AttendantOutput> => {
      chamadasDoCerebro.contagem += 1
      return SAIDA
    },
  },
}))

const chamadasDoCerebro = vi.hoisted(() => ({ contagem: 0 }))

const { processIncomingMessage } = await import('./conversation.server')

const CONTATO = 'test-retry-persistencia'
let conversaId: string

beforeEach(async () => {
  chamadasDoCerebro.contagem = 0
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
  vi.restoreAllMocks()
  await db.ticket.deleteMany({ where: { contactId: CONTATO } })
  await db.handoffEvent.deleteMany({ where: { conversationId: conversaId } })
  await db.lead.deleteMany({ where: { conversationId: conversaId } })
  await db.message.deleteMany({ where: { conversationId: conversaId } })
  await db.conversation.deleteMany({ where: { id: conversaId } })
})

describe('persistência final sob contenção', () => {
  it('uma falha transitória é reexecutada NA TRANSAÇÃO, sem repetir cliente nem cérebro', async () => {
    const real = db.$transaction.bind(db) as (a: unknown, b: unknown) => Promise<unknown>
    let tentativas = 0
    vi.spyOn(db, '$transaction').mockImplementation((async (fn: unknown, opts: unknown) => {
      tentativas += 1
      if (tentativas === 1) {
        // Falha no COMMIT, não na abertura — e a diferença importa. Lançar antes de executar
        // o corpo faz a primeira tentativa não escrever nada, e aí uma escrita que ESCAPOU da
        // transação (um `db.` no lugar de um `tx.`) nunca chega a rodar e passa despercebida.
        // Rodando o corpo inteiro e falhando depois, o que estiver dentro é desfeito pelo
        // rollback e o que estiver fora fica — que é exatamente o que queremos flagrar.
        await real(async (tx: unknown) => {
          await (fn as (t: unknown) => Promise<unknown>)(tx)
          throw new Error('SQLITE_BUSY: database is locked')
        }, opts)
      }
      return real(fn, opts)
    }) as typeof db.$transaction)

    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'consigo remarcar meu horário?',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    // A resposta saiu: a falha transitória não virou falha do atendimento.
    expect(r.reply).toBe(SAIDA.reply)
    expect(r.assistantMessageId).not.toBe('')

    // A transação foi tentada de novo...
    expect(tentativas).toBeGreaterThan(1)

    // ...mas o cérebro NÃO — é o que o retry local existe para evitar.
    expect(chamadasDoCerebro.contagem).toBe(1)

    // E a fala do cliente aparece UMA vez só.
    const papeis = (
      await db.message.findMany({
        where: { conversationId: conversaId },
        orderBy: { createdAt: 'asc' },
        select: { role: true },
      })
    ).map((m) => m.role)
    expect(papeis).toEqual(['user', 'assistant'])

    // Os efeitos da decisão, UMA vez cada: a tentativa que falhou não deixou rastro.
    expect(await db.ticket.count({ where: { contactId: CONTATO } })).toBe(1)
    expect(await db.lead.count({ where: { conversationId: conversaId, name: 'Maria' } })).toBe(1)
    expect(await db.handoffEvent.count({ where: { conversationId: conversaId } })).toBe(1)
  })

  it('o caminho do GUARD também repete a transação, sem chamar o cérebro', async () => {
    // Tema sensível é decidido pelo guard determinístico e NÃO passa pelo cérebro — é outro
    // ponto de persistência, com outra transação. Sem este teste, remover o retry só do guard
    // sobreviveria: o teste de cima atravessa apenas o caminho do cérebro.
    const real = db.$transaction.bind(db)
    let tentativas = 0
    vi.spyOn(db, '$transaction').mockImplementation((async (fn: unknown, opts: unknown) => {
      tentativas += 1
      if (tentativas === 1) {
        throw new Error('SQLITE_BUSY: database is locked')
      }
      return (real as (a: unknown, b: unknown) => Promise<unknown>)(fn, opts)
    }) as typeof db.$transaction)

    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'preciso falar sobre o contrato e meus dados pessoais',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    // A escalação aconteceu, apesar da contenção.
    expect(r.assistantMessageId).not.toBe('')
    expect(tentativas).toBeGreaterThan(1)

    // O guard decide sozinho: o cérebro nunca foi chamado, nem antes nem depois do retry.
    expect(chamadasDoCerebro.contagem).toBe(0)

    // Uma fala do cliente, uma resposta, um handoff — a tentativa perdida não deixou rastro.
    const papeis = (
      await db.message.findMany({
        where: { conversationId: conversaId },
        orderBy: { createdAt: 'asc' },
        select: { role: true },
      })
    ).map((m) => m.role)
    expect(papeis).toEqual(['user', 'assistant'])
    expect(await db.handoffEvent.count({ where: { conversationId: conversaId } })).toBe(1)
  })

  it('transação que JÁ COMEÇOU e morreu NÃO é repetida', async () => {
    // A distinção que separa um retry seguro de um duplicador de efeitos.
    //
    // `P2028` cobre dois sentidos opostos: a transação que não conseguiu COMEÇAR dentro do
    // `maxWait` (aquisição — nada foi escrito, repetir é seguro) e a que já começou e morreu
    // ("already closed", "not found", "expired"). No segundo caso a tentativa anterior PODE ter
    // escrito, e repetir é exatamente como se duplica chamado, lead e handoff.
    //
    // Um classificador que olhe só a redação — "timed out", "not found", "deadlock" — não
    // distingue os dois, e a redação "timed out" ainda por cima aparece em erro de socket, de
    // fetch, de qualquer biblioteca. Este teste é o que impede alguém de trocar o
    // classificador de `setup/retry.ts` por um mais permissivo.
    const real = db.$transaction.bind(db) as (a: unknown, b: unknown) => Promise<unknown>
    let tentativas = 0
    vi.spyOn(db, '$transaction').mockImplementation((async (fn: unknown, opts: unknown) => {
      tentativas += 1
      if (tentativas === 1) {
        const erro = Object.assign(
          new Error('Transaction API error: Transaction already closed: Transaction not found.'),
          { code: 'P2028' },
        )
        throw erro
      }
      return real(fn, opts)
    }) as typeof db.$transaction)

    await expect(
      processIncomingMessage({
        tenantSlug: 'dgc',
        message: 'consigo remarcar meu horário?',
        contactId: CONTATO,
        mode: 'whatsapp',
      }),
    ).rejects.toThrow('Transaction already closed')

    expect(tentativas).toBe(1)
  })

  it('erro que NÃO é de contenção propaga na hora, sem tentar de novo', async () => {
    // Sem isto, o retry viraria "tenta três vezes qualquer coisa": um defeito de verdade
    // (constraint violada, bug de escrita) demoraria três vezes mais para aparecer e o log
    // ficaria com três cópias do mesmo erro.
    const real = db.$transaction.bind(db)
    let tentativas = 0
    vi.spyOn(db, '$transaction').mockImplementation((async (fn: unknown, opts: unknown) => {
      tentativas += 1
      if (tentativas === 1) {
        throw new Error('Unique constraint failed on the fields: (`id`)')
      }
      return (real as (a: unknown, b: unknown) => Promise<unknown>)(fn, opts)
    }) as typeof db.$transaction)

    await expect(
      processIncomingMessage({
        tenantSlug: 'dgc',
        message: 'consigo remarcar meu horário?',
        contactId: CONTATO,
        mode: 'whatsapp',
      }),
    ).rejects.toThrow('Unique constraint')

    expect(tentativas).toBe(1)
  })
})
