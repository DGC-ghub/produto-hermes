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

/** Resposta simples: o foco aqui é a persistência, não a decisão do cérebro. */
const SAIDA: AttendantOutput = {
  reply: 'Claro, posso ajudar com isso.',
  needsHuman: false,
  handoffReason: null,
  leadPatch: null,
  confidence: 0.9,
  action: null,
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
  await db.message.deleteMany({ where: { conversationId: conversaId } })
  await db.conversation.deleteMany({ where: { id: conversaId } })
})

describe('persistência final sob contenção', () => {
  it('uma falha transitória é reexecutada NA TRANSAÇÃO, sem repetir cliente nem cérebro', async () => {
    const real = db.$transaction.bind(db)
    let tentativas = 0
    vi.spyOn(db, '$transaction').mockImplementation((async (fn: unknown, opts: unknown) => {
      tentativas += 1
      if (tentativas === 1) {
        // O modo de falha real: contenção do arquivo, não defeito da operação.
        throw new Error('SQLITE_BUSY: database is locked')
      }
      return (real as (a: unknown, b: unknown) => Promise<unknown>)(fn, opts)
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
