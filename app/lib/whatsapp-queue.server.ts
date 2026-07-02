// Fila do canal WhatsApp — a ponte confiável entre o webhook e o motor.
//
// Antes: o webhook devolvia 200 e processava em fire-and-forget; um restart no
// meio dos ~20s do cérebro perdia a mensagem PRA SEMPRE, e um redelivery da Meta
// respondia o cliente duas vezes. Agora: o evento é PERSISTIDO antes do 200
// (WebhookEvent, com @unique no wamid pra dedup), e um drain processa os
// pendentes — na chegada de cada POST e num sweeper periódico (que também retoma
// o que ficou pendente de antes de um restart). Bloqueio C2 do plano de entrega.
import { db } from '../db.server'
import { reportDegradation } from './alarm.server'
import { processIncomingMessage } from './conversation.server'
import {
  type InboundMessage,
  resolveTenantSlugByPhoneNumber,
  sendWhatsAppMessage,
} from './whatsapp.server'

// Depois de MAX_ATTEMPTS o evento vira 'failed' e sai da fila: um evento-veneno
// (ex.: tenant não mapeado) não pode entupir o drain pra sempre.
const MAX_ATTEMPTS = 5
const SWEEP_INTERVAL_MS = 60_000
const DRAIN_BATCH = 20

/**
 * Persiste as mensagens recebidas ANTES do 200 pra Meta. Idempotente por
 * messageId (wamid): redelivery não cria segundo evento. Retorna quantos são novos.
 */
export async function persistInbound(messages: InboundMessage[]): Promise<number> {
  let created = 0
  for (const message of messages) {
    try {
      await db.webhookEvent.create({
        data: {
          messageId: message.messageId,
          phoneNumberId: message.phoneNumberId,
          contactId: message.from,
          text: message.text,
        },
      })
      created += 1
    } catch (error) {
      // P2002 = unique violation (redelivery da Meta) — ignora em silêncio, é o dedup.
      const code = (error as { code?: string })?.code
      if (code !== 'P2002') {
        throw error
      }
    }
  }
  return created
}

async function processEvent(event: {
  id: string
  phoneNumberId: string
  contactId: string
  text: string
}): Promise<void> {
  const tenantSlug = await resolveTenantSlugByPhoneNumber(event.phoneNumberId)
  if (!tenantSlug) {
    throw new Error(`número sem empresa mapeada: ${event.phoneNumberId}`)
  }
  const result = await processIncomingMessage({
    tenantSlug,
    message: event.text,
    contactId: event.contactId,
  })
  // Só responde se o Hermes gerou texto (em atendimento humano ele fica em silêncio).
  if (result.reply.trim().length > 0) {
    const sent = await sendWhatsAppMessage(event.contactId, result.reply, event.phoneNumberId)
    // Falha de ENVIO não marca o evento como falho: a mensagem FOI processada
    // (reprocessar duplicaria chamado/lead). Alarma e segue.
    if (!sent) {
      void reportDegradation('envio_whatsapp_falhou')
    }
  }
}

// Uma passada de drain por vez (single-instance no Pi). O lock é do processo:
// dois POSTs simultâneos não processam o mesmo evento em paralelo.
let draining = false

/**
 * Processa os eventos pendentes, mais antigos primeiro. Cada tentativa incrementa
 * `attempts` ANTES de processar (crash no meio conta como tentativa — sem loop
 * infinito de um evento que derruba o processo). Nunca lança.
 */
export async function drainPending(): Promise<void> {
  if (draining) {
    return
  }
  draining = true
  try {
    const pending = await db.webhookEvent.findMany({
      where: { status: 'pending', attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: DRAIN_BATCH,
    })
    for (const event of pending) {
      await db.webhookEvent.update({
        where: { id: event.id },
        data: { attempts: { increment: 1 } },
      })
      try {
        await processEvent(event)
        await db.webhookEvent.update({
          where: { id: event.id },
          data: { status: 'done', processedAt: new Date() },
        })
      } catch (error) {
        console.error(
          `[whatsapp-queue] falha ao processar ${event.messageId} (tentativa ${event.attempts + 1}):`,
          error instanceof Error ? error.message : error,
        )
        if (event.attempts + 1 >= MAX_ATTEMPTS) {
          await db.webhookEvent.update({
            where: { id: event.id },
            data: { status: 'failed' },
          })
          void reportDegradation('webhook_evento_descartado')
        }
        // < MAX_ATTEMPTS: continua 'pending'; o próximo drain tenta de novo.
      }
    }
  } catch (error) {
    console.error(
      '[whatsapp-queue] drain falhou:',
      error instanceof Error ? error.message : error,
    )
  } finally {
    draining = false
  }
}

// Sweeper: retoma pendências deixadas por um restart mesmo sem POST novo chegar.
// unref() — o timer não segura o processo (nem o vitest) aberto. O guard em
// globalThis evita timer duplicado no HMR de dev.
declare global {
  var __hermesQueueSweeper: ReturnType<typeof setInterval> | undefined
}

export function startQueueSweeper(): void {
  if (globalThis.__hermesQueueSweeper) {
    return
  }
  const timer = setInterval(() => {
    void drainPending()
  }, SWEEP_INTERVAL_MS)
  timer.unref()
  globalThis.__hermesQueueSweeper = timer
}
