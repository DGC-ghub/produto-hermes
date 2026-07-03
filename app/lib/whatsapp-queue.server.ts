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
          kind: message.kind,
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

// Resposta de cortesia pra áudio/mídia — melhor que o vácuo que o público de home
// care recebia. A transcrição de verdade (whisper) entra na 2ª quinzena de agosto.
const UNSUPPORTED_MEDIA_REPLY =
  'Recebi seu áudio/arquivo 🙏 Por enquanto eu só consigo ler mensagens de TEXTO por aqui — pode escrever o que você precisa?'

async function processEvent(event: {
  id: string
  phoneNumberId: string
  contactId: string
  text: string
  kind: string
}): Promise<void> {
  // Áudio/mídia: responde a cortesia SEM rodar o motor (nem criar conversa) —
  // o conteúdo real a gente ainda não lê, então não há o que registrar.
  if (event.kind === 'unsupported') {
    const sent = await sendWhatsAppMessage(
      event.contactId,
      UNSUPPORTED_MEDIA_REPLY,
      event.phoneNumberId,
    )
    if (!sent) {
      void reportDegradation('envio_whatsapp_falhou')
    }
    return
  }
  const tenantSlug = await resolveTenantSlugByPhoneNumber(event.phoneNumberId)
  if (!tenantSlug) {
    throw new Error(`número sem empresa mapeada: ${event.phoneNumberId}`)
  }
  const result = await processIncomingMessage({
    tenantSlug,
    message: event.text,
    contactId: event.contactId,
    channel: 'whatsapp',
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
let drainRequested = false

/**
 * Processa os eventos pendentes, mais antigos primeiro. Cada tentativa incrementa
 * `attempts` ANTES de processar (crash no meio conta como tentativa — sem loop
 * infinito de um evento que derruba o processo). Nunca lança.
 */
export async function drainPending(): Promise<void> {
  if (draining) {
    // POST chegou NO MEIO de um drain: sinaliza pra rodar de novo ao terminar.
    // Sem isto, a mensagem nova ficava esperando o sweeper — até 60s de latência
    // extra pro cliente, justamente no horário de movimento.
    drainRequested = true
    return
  }
  draining = true
  try {
    do {
      drainRequested = false
      await drainBatch()
    } while (drainRequested)
  } catch (error) {
    // Se a mensagem vier vazia (ex.: PrismaClientValidationError), loga o objeto
    // inteiro — mensagem vazia já escondeu um erro de client desatualizado aqui.
    const message = error instanceof Error && error.message ? error.message : error
    console.error('[whatsapp-queue] drain falhou:', message)
  } finally {
    draining = false
  }
}

// 'processing' órfão (crash entre claim e desfecho) volta pra fila depois disto.
const STALE_PROCESSING_MS = 10 * 60 * 1000

async function drainBatch(): Promise<void> {
  // Faxina antes do lote: (a) 'processing' órfão de crash volta pra 'pending';
  // (b) 'pending' que já estourou as tentativas (crash na última) vira 'failed'
  // — sem isto ele ficava zumbi, invisível pro filtro e nunca alarmado.
  await db.webhookEvent.updateMany({
    where: { status: 'processing', claimedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
    data: { status: 'pending' },
  })
  await db.webhookEvent.updateMany({
    where: { status: 'pending', attempts: { gte: MAX_ATTEMPTS } },
    data: { status: 'failed' },
  })

  const pending = await db.webhookEvent.findMany({
    where: { status: 'pending', attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: DRAIN_BATCH,
  })
  for (const event of pending) {
    // Claim ATÔMICO por linha: o lock `draining` é por processo, mas o banco pode
    // ter outro escritor (outro drain, `npm run dev` no mesmo Pi). Só quem virou a
    // linha 'pending'→'processing' processa — updateMany condicional decide.
    const claimed = await db.webhookEvent.updateMany({
      where: { id: event.id, status: 'pending' },
      data: { status: 'processing', claimedAt: new Date(), attempts: { increment: 1 } },
    })
    if (claimed.count === 0) {
      continue
    }
    try {
      await processEvent(event)
      await markDone(event.id)
    } catch (error) {
      console.error(
        `[whatsapp-queue] falha ao processar ${event.messageId} (tentativa ${event.attempts + 1}):`,
        error instanceof Error ? error.message : error,
      )
      const exhausted = event.attempts + 1 >= MAX_ATTEMPTS
      await db.webhookEvent
        .update({
          where: { id: event.id },
          data: { status: exhausted ? 'failed' : 'pending' },
        })
        .catch(() => {})
      if (exhausted) {
        void reportDegradation('webhook_evento_descartado')
      }
    }
  }
}

// 'Processou mas não consegui marcar' NÃO é 'processamento falhou': o cliente já
// recebeu a resposta — voltar pra fila reprocessaria o LLM e mandaria mensagem
// DUPLA. Retry local (SQLITE_BUSY é transitório); se esgotar, fica 'processing'
// e o requeue de órfãos decide em 10 min — janela pequena e alarmada.
async function markDone(id: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.webhookEvent.update({
        where: { id },
        data: { status: 'done', processedAt: new Date() },
      })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  console.error(`[whatsapp-queue] CRÍTICO: evento ${id} processado mas não marcado como done`)
  void reportDegradation('webhook_done_nao_marcado')
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

// Auto-início na carga do módulo: este arquivo é .server (nunca vai pro client) e
// é importado pela rota do webhook, que o build de produção carrega no boot — o
// sweeper liga junto do servidor. Chamar da ROTA quebrava o build (módulo server
// referenciado em escopo de client). Em teste/dev o timer é unref'd: inofensivo.
startQueueSweeper()
