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

// Evento de entrada normalizado do canal Baileys — o gerente já filtrou (nada de
// msg própria/histórico) e extraiu o essencial. O Passo 5 resolve o tenant pela
// sessão e persiste na fila (mesmo caminho do inbound Meta). Ver plano §1.2/§5.
export type InboundEvent = {
  channelSessionId: string // a sessão Baileys que recebeu (resolve o tenant)
  contactId: string // MSISDN do cliente (só dígitos, casa com o wa_id da Meta)
  remoteJid: string // endereço ORIGINAL pra responder (sock.sendMessage), sem reconstruir
  messageId: string // key.id — dedup POR sessão (não é único global)
  kind: 'text' | 'unsupported'
  text?: string
  mediaType?: string // tipo original quando não-suportado (audio/image/...)
}
