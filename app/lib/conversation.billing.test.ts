// O CAMINHO DO GATE DE COBRANÇA também precisa obedecer a autoridade da conversa.
//
// Quando a assinatura não permite atender, o motor grava a fala do cliente e manda a conversa
// para a fila humana. Duas coisas davam errado: um `update` cego atropelava quem estivesse
// conduzindo, e as duas escritas (fala do cliente, status) não eram atômicas — se a primeira
// commitasse e a segunda falhasse, o reprocessamento gravava a fala do cliente outra vez.
//
// A JANELA. A guarda de silêncio lê o status ANTES da consulta ao gate, e a conversa já está
// resolvida quando o gate roda. Por isso o cenário aqui muda o status DURANTE a consulta —
// uma versão anterior deste teste marcava a conversa como `closed` ANTES de chamar o motor, e
// com isso a resolução por identidade (que ignora encerradas) abria uma conversa NOVA: o gate
// operava na nova, a antiga seguia intacta por não ser alvo de nada, e o teste passava mesmo
// com o `update` cego de volta no lugar.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'

const controle = vi.hoisted(() => ({
  conversaId: '',
  /** O estado que a conversa assume ENQUANTO o gate é consultado. */
  statusDuranteGate: null as null | 'human' | 'closed',
}))

vi.mock('./billing-gate.server', () => ({
  isBillingGateEnabled: () => true,
  checkBillingGate: async () => {
    if (controle.statusDuranteGate) {
      const { db: banco } = await import('../db.server')
      await banco.conversation.update({
        where: { id: controle.conversaId },
        data: { status: controle.statusDuranteGate },
      })
    }
    return { allowed: false, reason: 'inactive' as const }
  },
}))

const { processIncomingMessage } = await import('./conversation.server')

const CONTATO = 'test-billing-autoridade'

async function estado() {
  const conversa = await db.conversation.findUniqueOrThrow({
    where: { id: controle.conversaId },
  })
  const mensagens = await db.message.findMany({
    where: { conversationId: controle.conversaId },
    select: { role: true },
  })
  return {
    status: conversa.status,
    user: mensagens.filter((m) => m.role === 'user').length,
    assistant: mensagens.filter((m) => m.role === 'assistant').length,
    tickets: await db.ticket.count({ where: { contactId: CONTATO } }),
    leads: await db.lead.count({ where: { conversationId: controle.conversaId } }),
    handoffs: await db.handoffEvent.count({ where: { conversationId: controle.conversaId } }),
  }
}

beforeEach(async () => {
  controle.statusDuranteGate = null
  const tenant = await db.tenant.upsert({
    where: { slug: 'dgc' },
    update: {},
    create: { slug: 'dgc', name: 'DGC Hub' },
  })
  controle.conversaId = (
    await db.conversation.create({
      data: { tenantId: tenant.id, contactId: CONTATO, channel: 'whatsapp', status: 'open' },
    })
  ).id
})

afterEach(async () => {
  vi.restoreAllMocks()
  await db.ticket.deleteMany({ where: { contactId: CONTATO } })
  await db.handoffEvent.deleteMany({ where: { conversationId: controle.conversaId } })
  await db.lead.deleteMany({ where: { conversationId: controle.conversaId } })
  await db.message.deleteMany({ where: { conversationId: controle.conversaId } })
  await db.conversation.deleteMany({ where: { id: controle.conversaId } })
})

describe('gate de cobrança e a autoridade da conversa', () => {
  it.each([
    'human',
    'closed',
  ] as const)('preserva `%s` quando o estado muda durante a consulta ao gate', async (statusFinal) => {
    controle.statusDuranteGate = statusFinal

    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi, preciso de ajuda',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    const depois = await estado()

    // A autoridade de quem decidiu fica de pé: o gate não puxa a conversa de volta.
    expect(depois.status).toBe(statusFinal)

    // A fala do cliente chegou ANTES da mudança vencer, então fica registrada — uma vez só.
    expect(depois.user).toBe(1)

    // E nada mais: o gate não responde, não abre chamado, não escala.
    expect(r.reply).toBe('')
    expect(r.assistantMessageId).toBe('')
    expect(depois.assistant).toBe(0)
    expect(depois.tickets).toBe(0)
    expect(depois.leads).toBe(0)
    expect(depois.handoffs).toBe(0)
  })

  it('falha na persistência não deixa a fala do cliente órfã', async () => {
    // A ATOMICIDADE, e não só a autoridade. Se a fala do cliente commitasse sozinha e o status
    // falhasse, o motor lançaria, a fila devolveria o evento para `pending` e o
    // reprocessamento gravaria a fala DE NOVO — o atendente veria a pessoa falando duas vezes.
    //
    // Este teste é o que segura a fala do cliente dentro da transação: movê-la para fora passa
    // pelo scanner de fronteira sem reclamar (não é violação dele), e só cai aqui.
    const real = db.$transaction.bind(db)
    vi.spyOn(db, '$transaction').mockImplementation((async () => {
      // Erro PERMANENTE: não é contenção, então propaga na primeira tentativa.
      throw new Error('Unique constraint failed on the fields: (`id`)')
    }) as typeof db.$transaction)

    await expect(
      processIncomingMessage({
        tenantSlug: 'dgc',
        message: 'oi, preciso de ajuda',
        contactId: CONTATO,
        mode: 'whatsapp',
      }),
    ).rejects.toThrow('Unique constraint')

    vi.mocked(db.$transaction).mockImplementation(real)
    expect((await estado()).user).toBe(0)
  })

  it('sem mudança de estado, o gate manda a conversa para a fila humana — o par positivo', async () => {
    // Sem este, uma correção que simplesmente parasse de escrever ficaria verde acima e o
    // cliente bloqueado por cobrança nunca chegaria a um humano.
    await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi, preciso de ajuda',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    const depois = await estado()
    expect(depois.status).toBe('needs_human')
    expect(depois.user).toBe(1)
    expect(depois.assistant).toBe(0)
  })
})
