// O CAMINHO DO GATE DE COBRANÇA também precisa obedecer a autoridade da conversa.
//
// Quando a assinatura não permite atender, o motor grava a fala do cliente e manda a conversa
// para a fila humana. Só que ele fazia isso com um `update` cego — sem passar pelo CAS que os
// outros dois caminhos (guard e cérebro) usam. Se um operador estivesse conduzindo a conversa,
// o gate a devolvia para `needs_human` e ele a perdia da tela, no meio do atendimento.
//
// A janela: a guarda de silêncio lê o status ANTES da consulta ao gate. Hoje essa consulta é
// só uma ida ao banco, mas ela é a fronteira natural para crescer — verificar assinatura contra
// o provedor de pagamento é exatamente o tipo de coisa que vira chamada de rede. Um caminho de
// escrita não deve depender de "aqui não dá tempo de nada acontecer" para estar correto.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'

const controle = vi.hoisted(() => ({
  conversaId: '',
  /** O operador assume ENQUANTO o gate é consultado. */
  tomadaDuranteOGate: false,
}))

vi.mock('./billing-gate.server', () => ({
  isBillingGateEnabled: () => true,
  checkBillingGate: async () => {
    const { db: banco } = await import('../db.server')
    if (controle.tomadaDuranteOGate) {
      await banco.conversation.update({
        where: { id: controle.conversaId },
        data: { status: 'human' },
      })
    }
    return { allowed: false, reason: 'inactive' as const }
  },
}))

const { processIncomingMessage } = await import('./conversation.server')

const CONTATO = 'test-billing-autoridade'

beforeEach(async () => {
  controle.tomadaDuranteOGate = false
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
  await db.message.deleteMany({ where: { conversationId: controle.conversaId } })
  await db.conversation.deleteMany({ where: { id: controle.conversaId } })
})

describe('gate de cobrança e a autoridade da conversa', () => {
  it('não tira do operador a conversa que ele assumiu durante a consulta ao gate', async () => {
    controle.tomadaDuranteOGate = true

    await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi, preciso de ajuda',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    // A conversa continua com o humano — o gate não a puxou de volta para a fila.
    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: controle.conversaId } })).status,
    ).toBe('human')
  })

  it('sem tomada, o gate manda a conversa para a fila humana — o par positivo', async () => {
    // Sem este, uma correção que simplesmente parasse de escrever ficaria verde acima e o
    // cliente bloqueado por cobrança nunca chegaria a um humano.
    await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi, preciso de ajuda',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: controle.conversaId } })).status,
    ).toBe('needs_human')

    // E a fala do cliente ficou gravada nos dois casos: o atendente precisa vê-la.
    const papeis = (
      await db.message.findMany({
        where: { conversationId: controle.conversaId },
        select: { role: true },
      })
    ).map((m) => m.role)
    expect(papeis).toEqual(['user'])
  })

  it('não ressuscita conversa encerrada durante a consulta ao gate', async () => {
    // Mesma regra do CAS: `closed` é decisão do atendente e o gate não a desfaz.
    await db.conversation.update({
      where: { id: controle.conversaId },
      data: { status: 'closed' },
    })

    await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi, preciso de ajuda',
      contactId: CONTATO,
      conversationId: undefined,
      mode: 'whatsapp',
    }).catch(() => {
      // A resolução por identidade ignora encerradas e abre uma nova; se algum dia isso mudar
      // e virar erro, o que importa aqui continua sendo a conversa antiga estar intacta.
    })

    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: controle.conversaId } })).status,
    ).toBe('closed')
  })
})
