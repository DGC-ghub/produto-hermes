import { createHash } from 'node:crypto'

/**
 * O IDENTIFICADOR DO ENVIO, ESCOLHIDO POR NÓS (6C.8B T3a).
 *
 * Quem escolhia o identificador de uma resposta era a biblioteca (Baileys), e só ficávamos
 * sabendo qual foi DEPOIS da chamada. Aqui a ordem se inverte: nós derivamos o identificador
 * antes e o passamos adiante.
 *
 * Sozinho isto não muda nada visível — é o encanamento de que o T3b vai precisar para, no futuro,
 * repetir um envio em dúvida sem o cliente receber duas vezes. O T3a **não** liga esse retry,
 * **não** cria coluna e **não** toca no banco.
 *
 * ⚠️ **O FORMATO NÃO É ESCOLHA ESTÉTICA.** O T2 (`docs/spike-baileys-messageid.md`) mediu a
 * deduplicação do WhatsApp usando `generateMessageID()`, a função do PRÓPRIO Baileys, tanto no
 * experimento quanto no controle negativo — um identificador de formato arbitrário NUNCA foi
 * testado contra o provedor. O formato observado é `'3EB0' + 36 hex MAIÚSCULOS`
 * (`node_modules/@whiskeysockets/baileys/lib/Utils/generics.js:150`), e esta derivação o preserva
 * de propósito: sair dele é abandonar a única evidência que temos, e o erro só apareceria em
 * produção.
 *
 * **Âncora = `WebhookEvent.id`**, não o `messageId`. É a chave de linha que o T5 já vai usar como
 * `sourceEventId`; duas âncoras diferentes para o mesmo evento viram dívida no dia seguinte.
 */

// Por que o propósito entra na chave: hoje os dois envios de um evento são mutuamente exclusivos
// (a cortesia de mídia dá `return` antes do motor), então um identificador por evento bastaria. O
// discriminante existe para o dia em que deixarem de ser — mesmo desenho do
// `(sourceEventId, sourceEventKind)` do T5.
export type OutboundPurpose = 'reply' | 'media_courtesy'

const PREFIXO = '3EB0'
const HEX = 36

/**
 * Deriva o identificador de UM envio a partir do evento de origem e do propósito. Função pura e
 * determinística entre processos — nada de aleatório, nada de relógio: é justamente por ser
 * reproduzível que uma retomada futura consegue chegar ao MESMO identificador.
 *
 * ⚠️ O valor está congelado por um teste golden. Trocar o algoritmo depois que o T3b estiver em
 * produção quebraria a idempotência em silêncio.
 */
export function deriveOutboundMessageId(eventId: string, purpose: OutboundPurpose): string {
  // `:` como separador: o `WebhookEvent.id` é um cuid (alfanumérico, sem dois-pontos) e o
  // propósito é um enum fechado, então nenhum par distinto de (evento, propósito) consegue
  // produzir a mesma entrada por concatenação.
  const digest = createHash('sha256').update(`${eventId}:${purpose}`).digest('hex')
  return PREFIXO + digest.slice(0, HEX).toUpperCase()
}
