import { sendWhatsAppMessage } from '../whatsapp.server'
import type { ChannelRef } from './types'

// Despacha o envio de UMA resposta pro canal certo. Best-effort → boolean: nunca
// lança, false = não enviou (contrato do qual a fila e o operator-reply dependem).
// Hoje só o canal Meta envia; o adaptador Baileys entra no Passo 4 do plano
// (docs/plano-vendavel-v1.md §5) — até lá, ref baileys devolve false sem enviar.
export async function sendReply(ref: ChannelRef, to: string, text: string): Promise<boolean> {
  switch (ref.kind) {
    case 'meta':
      return sendWhatsAppMessage(to, text, ref.phoneNumberId)
    case 'baileys':
      console.warn('[channel] canal baileys ainda não implementado (Passo 4)')
      return false
  }
}
