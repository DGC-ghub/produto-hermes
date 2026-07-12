import { db } from '../db.server'
import { sendReply } from './channels/dispatch.server'
import { metaRef } from './channels/types'
import { listTenantWhatsappNumbers } from './whatsapp.server'

// Resposta do operador humano ao cliente pela Central (Tier 2 — a "última milha" do handoff).
// Quando o atendente assume, ele digita aqui e a mensagem VAI pelo WhatsApp e fica registrada
// na conversa. Escopado por tenant — nunca responde a conversa de outra empresa. Server-side.

export type OperatorReplyResult = { ok: boolean; error?: string }

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
  // Número da empresa que envia (o primeiro registrado; cai no env global se não houver).
  const numbers = await listTenantWhatsappNumbers(input.tenantSlug)
  const sent = await sendReply(metaRef(numbers[0]?.phoneNumberId), input.contactId, text)

  // Registra a fala do operador na conversa mesmo se o envio falhar — o histórico não mente.
  await db.message.create({
    data: { conversationId: conversation.id, role: 'assistant', content: text },
  })
  await db.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  })

  if (!sent) {
    return {
      ok: false,
      error: 'Registrei a mensagem, mas o envio pelo WhatsApp falhou. Confira o número conectado.',
    }
  }
  return { ok: true }
}
