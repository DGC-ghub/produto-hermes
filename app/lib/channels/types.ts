// Abstração de canal de mensageria. O motor (processIncomingMessage) não conhece o
// transporte — só produz texto; o balcão despacha pro canal certo. Hoje: Meta (Cloud
// API). Próximo: Baileys (QR, self-service). Ver docs/plano-vendavel-v1.md §1.2.

export type ChannelKind = 'meta' | 'baileys'

// Endereço do canal que ENVIA — diz qual transporte/credencial usar.
// - meta: o phoneNumberId é a chave de envio (opcional → cai no env global, como hoje).
// - baileys: a sessão (socket) daquele número; o adaptador entra no Passo 4.
export type ChannelRef =
  | { kind: 'meta'; phoneNumberId?: string }
  | { kind: 'baileys'; sessionId: string }

// Helper do canal oficial da Meta (preserva o fallback pro env quando sem número).
export function metaRef(phoneNumberId?: string): ChannelRef {
  return { kind: 'meta', phoneNumberId }
}
