// A CONVERSA SOBE NA FILA QUANDO O CLIENTE FALA — mesmo com um humano conduzindo.
//
// `getHandoffQueue` ordena por `updatedAt` desc e corta em 50. Criar uma `Message` NÃO toca
// `Conversation.updatedAt`: só o `update` na linha da conversa faz isso. São dois carimbos, em
// dois caminhos diferentes, e é o que faz a mensagem nova subir na tela de `/atendente`
// enquanto o atendimento humano acontece.
//
// É o caminho de MAIOR frequência de toda a 6C — vale para toda mensagem de todo cliente
// durante atendimento humano, sem nenhuma condição exótica —, e não tinha prova em lugar
// nenhum. Apagar qualquer um dos dois carimbos passava pela suíte inteira, e o efeito é o pior
// possível: o cliente escreve, a conversa AFUNDA na lista, some do topo, e o operador só
// descobre horas depois.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import { getHandoffQueue } from './dossier.server'

const controle = vi.hoisted(() => ({
  conversaId: '',
  bloquearCobranca: false,
  tomarDuranteGate: false,
}))

vi.mock('./billing-gate.server', () => ({
  isBillingGateEnabled: () => true,
  checkBillingGate: async () => {
    // O operador assume DURANTE a consulta ao gate. Só assim o carimbo do billing é
    // alcançado: com a conversa já em `human` na entrada, o fluxo retorna antes de chegar lá.
    //
    // O `updatedAt` é forçado para trás de propósito. `@updatedAt` carimba sozinho a cada
    // update, então a própria tomada já traria a conversa para o topo — e o teste passaria
    // sem provar nada sobre o carimbo do billing.
    if (controle.tomarDuranteGate) {
      const { db: banco } = await import('../db.server')
      await banco.conversation.update({
        where: { id: controle.conversaId },
        data: { status: 'human', updatedAt: new Date('2020-01-01T00:00:00Z') },
      })
    }
    return controle.bloquearCobranca
      ? { allowed: false, reason: 'inactive' as const }
      : { allowed: true, reason: 'active' as const }
  },
}))

const { processIncomingMessage } = await import('./conversation.server')

const ANTIGA = 'test-fila-antiga'
const RECENTE = 'test-fila-recente'
let tenantId: string
let antigaId: string

beforeEach(async () => {
  controle.bloquearCobranca = false
  controle.tomarDuranteGate = false
  const tenant = await db.tenant.upsert({
    where: { slug: 'dgc' },
    update: {},
    create: { slug: 'dgc', name: 'DGC Hub' },
  })
  tenantId = tenant.id

  // A conversa do nosso cliente está em atendimento humano e é a MAIS ANTIGA da fila.
  antigaId = (
    await db.conversation.create({
      data: {
        tenantId,
        contactId: ANTIGA,
        channel: 'whatsapp',
        status: 'human',
        updatedAt: new Date('2020-01-01T00:00:00Z'),
      },
    })
  ).id
  controle.conversaId = antigaId

  // E há outra, mais recente, ocupando o topo.
  await db.conversation.create({
    data: {
      tenantId,
      contactId: RECENTE,
      channel: 'whatsapp',
      status: 'needs_human',
      updatedAt: new Date('2020-06-01T00:00:00Z'),
    },
  })
})

afterEach(async () => {
  const ids = (
    await db.conversation.findMany({
      where: { contactId: { in: [ANTIGA, RECENTE] } },
      select: { id: true },
    })
  ).map((c) => c.id)
  await db.messageTrace.deleteMany({ where: { conversationId: { in: ids } } })
  await db.message.deleteMany({ where: { conversationId: { in: ids } } })
  await db.conversation.deleteMany({ where: { id: { in: ids } } })
})

/** A conversa do nosso contato está no topo da fila do operador? */
async function noTopoDaFila() {
  const fila = await getHandoffQueue(tenantId)
  return fila[0]?.conversationId === antigaId
}

describe('a fala do cliente reordena a fila do operador', () => {
  it('humano conduzindo: a mensagem nova traz a conversa para o topo', async () => {
    expect(await noTopoDaFila()).toBe(false)

    await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi, ainda estou esperando',
      contactId: ANTIGA,
      mode: 'whatsapp',
    })

    // O Hermes ficou calado — mas a conversa subiu, que é o que o operador precisa ver.
    expect(await noTopoDaFila()).toBe(true)
  })

  it('tomada DURANTE o gate bloqueado: a conversa também sobe', async () => {
    // Outro carimbo, outro caminho. O gate bloqueado tem a própria transação, e perder o CAS
    // ali não pode significar deixar a conversa afundada — a fala do cliente acabou de chegar.
    //
    // A conversa começa `open` (senão o fluxo retorna no ramo de entrada e nunca chega ao
    // billing) e a tomada acontece no meio da consulta.
    await db.conversation.update({
      where: { id: antigaId },
      data: { status: 'open', updatedAt: new Date('2020-01-01T00:00:00Z') },
    })
    controle.bloquearCobranca = true
    controle.tomarDuranteGate = true
    expect(await noTopoDaFila()).toBe(false)

    await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi, ainda estou esperando',
      contactId: ANTIGA,
      mode: 'whatsapp',
    })

    expect(await noTopoDaFila()).toBe(true)
  })
})
