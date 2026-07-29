// Prova que a instrumentação está LIGADA no fluxo real — não basta o núcleo de
// métricas passar isolado: o que interessa é que uma mensagem de verdade,
// atravessando o orquestrador, deixe a medição gravada.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import { processIncomingMessage } from './conversation.server'
import { parseSteps } from './metrics.server'

const TEST_CONTACT_ID = 'test-metrics-trace'
const SLUG = 'dgc'

/** A gravação é disparada sem await (fora do caminho crítico) — esperamos ela pousar. */
async function waitForTrace(conversationId: string) {
  return vi.waitFor(
    async () => {
      const trace = await db.messageTrace.findFirst({ where: { conversationId } })
      if (!trace) {
        throw new Error('trace ainda não gravado')
      }
      return trace
    },
    { timeout: 3000, interval: 25 },
  )
}

afterEach(async () => {
  const conversations = await db.conversation.findMany({
    where: { contactId: TEST_CONTACT_ID },
    select: { id: true },
  })
  const ids = conversations.map((c) => c.id)
  await db.ticket.deleteMany({ where: { contactId: TEST_CONTACT_ID } })
  if (ids.length === 0) {
    return
  }
  await db.messageTrace.deleteMany({ where: { conversationId: { in: ids } } })
  await db.handoffEvent.deleteMany({ where: { conversationId: { in: ids } } })
  await db.lead.deleteMany({ where: { conversationId: { in: ids } } })
  await db.message.deleteMany({ where: { conversationId: { in: ids } } })
  await db.conversation.deleteMany({ where: { id: { in: ids } } })
})

describe('telemetria do fluxo de mensagem', () => {
  it('grava um trace com as etapas do caminho completo', async () => {
    const result = await processIncomingMessage({
      tenantSlug: SLUG,
      message: 'Quais são os preços dos serviços de vocês?',
      contactId: TEST_CONTACT_ID,
      channel: 'whatsapp',
    })

    const trace = await waitForTrace(result.conversationId)
    expect(trace.outcome).toBe('ok')
    expect(trace.channel).toBe('whatsapp')
    expect(trace.totalMs).toBeGreaterThan(0)

    const steps = parseSteps(trace.stepsJson)
    // As etapas do caminho feliz — se alguma sumir, o relatório fica cego naquele trecho.
    for (const step of [
      'tenant',
      'config',
      'conversation',
      'billing',
      'history',
      'knowledge',
      'retrieval',
      'brain',
      'persist_reply',
    ]) {
      expect(steps, `etapa "${step}" não foi medida`).toHaveProperty(step)
    }
    // brainMs é desnormalizado para consultar o gargalo sem abrir o JSON.
    expect(trace.brainMs).toBe(steps.brain)
  })

  it('marca guard_handoff e NÃO registra tempo de cérebro quando o guard curto-circuita', async () => {
    const result = await processIncomingMessage({
      tenantSlug: SLUG,
      message: 'quero falar com um atendente humano por favor',
      contactId: TEST_CONTACT_ID,
      channel: 'whatsapp',
    })

    const trace = await waitForTrace(result.conversationId)
    expect(trace.outcome).toBe('guard_handoff')
    expect(trace.provider).toBe('nenhum')
    // O valor da medição aqui: provar que o atalho barato não pagou o LLM.
    expect(trace.brainMs).toBeNull()
    expect(parseSteps(trace.stepsJson)).not.toHaveProperty('brain')
  })

  it('a soma das etapas não passa do total (o total engloba tudo)', async () => {
    const result = await processIncomingMessage({
      tenantSlug: SLUG,
      message: 'vocês atendem no centro?',
      contactId: TEST_CONTACT_ID,
    })

    const trace = await waitForTrace(result.conversationId)
    const soma = Object.values(parseSteps(trace.stepsJson)).reduce((a, b) => a + b, 0)
    expect(soma).toBeLessThanOrEqual(trace.totalMs + 0.5) // folga do arredondamento
  })
})
