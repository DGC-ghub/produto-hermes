import { sendWhatsAppMessage } from '../whatsapp.server'
import type { ChannelRef, SendResult } from './types'

// Despacha o envio de UMA resposta pro canal certo. NUNCA lança — o contrato do qual a fila e
// o operator-reply dependem —, mas o desfecho passou de `boolean` para `SendResult`: "não
// enviei" e "não sei se enviei" precisam ser distinguíveis, senão o sistema (e o operador)
// reenviam sobre a dúvida e o cliente recebe duas vezes. Ver `SendResult` em ./types.
export async function sendReply(ref: ChannelRef, to: string, text: string): Promise<SendResult> {
  switch (ref.kind) {
    case 'meta':
      return sendWhatsAppMessage(to, text, ref.phoneNumberId)
    case 'baileys': {
      // Import dinâmico: o Baileys (pesado) só carrega quando há canal QR em uso —
      // fora do caminho quente da Meta.
      const { sendText } = await import('./baileys.server')
      return sendText(ref.sessionId, to, text)
    }
  }
}
