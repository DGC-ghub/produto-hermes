import { db } from '../db.server'
import { reportDegradation } from './alarm.server'
import { sendReply } from './channels/dispatch.server'
import { metaRef, type SendResult } from './channels/types'
import { listTenantWhatsappNumbers } from './whatsapp.server'

// Resposta do operador humano ao cliente pela Central (Tier 2 — a "última milha" do handoff).
// Quando o atendente assume, ele digita aqui e a mensagem VAI pelo WhatsApp e fica registrada
// na conversa. Escopado por tenant — nunca responde a conversa de outra empresa. Server-side.

/**
 * `ambiguous` existe para a TELA saber que não pode afirmar que falhou. Sem esse terceiro
 * caso, o operador lê "o envio falhou", clica de novo, e o cliente recebe duas vezes.
 */
export type OperatorReplyResult = { ok: boolean; error?: string; ambiguous?: boolean }

export async function sendOperatorReply(input: {
  tenantId: string
  tenantSlug: string
  contactId: string
  text: string
}): Promise<OperatorReplyResult> {
  const text = input.text.trim()
  if (!text) {
    return { ok: false, error: 'Escreva uma mensagem antes de enviar.' }
  }
  // Conversa ativa do contato (a mais recente não fechada), escopada pelo tenant do operador.
  const conversation = await db.conversation.findFirst({
    where: { tenantId: input.tenantId, contactId: input.contactId, status: { not: 'closed' } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  if (!conversation) {
    return { ok: false, error: 'Nenhuma conversa ativa com este contato.' }
  }
  // Roteia pro canal certo: se a empresa tem uma sessão Baileys conectada, o operador
  // responde POR ELA (no jid @lid ORIGINAL da última entrada — responder aos dígitos
  // reconstruídos iria pro vácuo). Senão, canal oficial da Meta (comportamento antigo).
  const session = await db.channelSession.findFirst({
    where: { tenantId: input.tenantId, kind: 'baileys', status: 'conectado' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  let envio: SendResult
  if (session) {
    const lastInbound = await db.webhookEvent.findFirst({
      where: { channelSessionId: session.id, contactId: input.contactId },
      orderBy: { createdAt: 'desc' },
      select: { remoteJid: true },
    })
    if (!lastInbound?.remoteJid) {
      // Sem o jid original (evento antigo, pré-FU1): o envio pode ir pro vácuo — alarma
      // em vez de falhar em silêncio.
      void reportDegradation('baileys_operador_sem_remotejid')
    }
    envio = await sendReply(
      { kind: 'baileys', sessionId: session.id },
      lastInbound?.remoteJid ?? input.contactId,
      text,
    )
  } else {
    // Número da empresa que envia (o primeiro registrado; cai no env global se não houver).
    const numbers = await listTenantWhatsappNumbers(input.tenantSlug)
    envio = await sendReply(metaRef(numbers[0]?.phoneNumberId), input.contactId, text)
  }

  // Registra a fala do operador na conversa mesmo se o envio falhar — o histórico não mente.
  await db.message.create({
    data: { conversationId: conversation.id, role: 'assistant', content: text },
  })
  await db.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  })

  // O DESFECHO CONTADO COMO ELE É.
  //
  // Antes, qualquer coisa que não fosse sucesso virava "o envio falhou" — e o operador,
  // lendo isso, clicava de novo. Quando o caso real era "a requisição saiu e a resposta se
  // perdeu", o cliente recebia duas vezes. Duplicação sem crash, sem bug e sem log: a pessoa
  // fez exatamente o que a tela mandou.
  //
  // Em `ambiguous` a tela não afirma que falhou e não convida a reenviar — pede conferência.
  if (envio.status === 'ambiguous') {
    return {
      ok: false,
      ambiguous: true,
      error:
        'Registrei a mensagem, mas a confirmação do WhatsApp não voltou. Ela PODE ter sido ' +
        'enviada. Confira a conversa no aparelho antes de tentar de novo.',
    }
  }
  if (envio.status === 'not_sent') {
    return {
      ok: false,
      error: 'Registrei a mensagem, mas o envio pelo WhatsApp falhou. Confira o número conectado.',
    }
  }
  return { ok: true }
}
