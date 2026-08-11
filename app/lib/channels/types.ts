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

/**
 * O DESFECHO DE UM ENVIO — três casos, não dois.
 *
 * O contrato anterior era `Promise<boolean>`, e nele "não enviei" e "não sei se enviei" eram o
 * MESMO valor. Um `false` podia ser "sem token" (seguro reenviar) ou "a requisição saiu, o
 * provedor aceitou, e a resposta se perdeu na volta" (proibido reenviar) — e o código reenviava
 * nos dois casos. Daí saíam três caminhos de mensagem duplicada, nenhum deles precisando de bug:
 *
 *   1. o retry de envio, disparado por qualquer `false`;
 *   2. o reprocessamento do evento após crash;
 *   3. o OPERADOR: a tela dizia "não foi enviada", ele clicava de novo, e o cliente recebia
 *      duas vezes. Sem erro, sem log, fazendo exatamente o que a tela mandou.
 *
 * `providerMessageId` é OBRIGATÓRIO em `sent`, e não opcional. Um envio que "deu certo" sem
 * comprovante não é um envio confirmado — é justamente um caso ambíguo, e deixá-lo entrar como
 * `sent` com id nulo recriaria dentro do tipo a ambiguidade que ele existe para eliminar.
 *
 * `retryable` separa o que o `not_sent` sozinho não separava: 429 pede nova tentativa, 401 não.
 */
export type SendResult =
  | { status: 'sent'; providerMessageId: string }
  | { status: 'not_sent'; retryable: boolean; reason: string }
  | { status: 'ambiguous'; reason: string }

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
