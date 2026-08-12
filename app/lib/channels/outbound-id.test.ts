import { describe, expect, it } from 'vitest'
import { deriveOutboundMessageId } from './outbound-id.server'

// O ÚNICO formato que o T2 observou. O spike (`docs/spike-baileys-messageid.md`) usou
// `generateMessageID()`, a função do PRÓPRIO Baileys, tanto no experimento quanto no controle —
// um id de formato arbitrário nunca foi testado contra o WhatsApp. Sair deste formato é abandonar
// a única evidência que temos, e o erro só apareceria em produção.
const FORMATO_MEDIDO_NO_T2 = /^3EB0[0-9A-F]{36}$/

describe('deriveOutboundMessageId', () => {
  it('5. é determinístico — e bate com um valor FIXO escrito aqui (golden)', () => {
    // O golden é de propósito. Trocar o algoritmo depois que o T3b estiver em produção quebraria
    // a idempotência EM SILÊNCIO: os envios de antes da troca deixariam de ser reconhecíveis, e
    // repetir um deles entregaria uma segunda cópia ao cliente. Este teste obriga a decisão a
    // passar por uma pessoa.
    expect(deriveOutboundMessageId('evt_t3a_golden', 'reply')).toBe(
      '3EB0A24914DB390B1E3284A44DF34E62313E91AE',
    )
    // Chamada de novo, no mesmo processo e sem estado, devolve o mesmo valor.
    expect(deriveOutboundMessageId('evt_t3a_golden', 'reply')).toBe(
      deriveOutboundMessageId('evt_t3a_golden', 'reply'),
    )
  })

  it('6. sai no formato da biblioteca — 3EB0 + 36 hex MAIÚSCULOS', () => {
    expect(deriveOutboundMessageId('evt_qualquer', 'reply')).toMatch(FORMATO_MEDIDO_NO_T2)
    expect(deriveOutboundMessageId('evt_qualquer', 'media_courtesy')).toMatch(FORMATO_MEDIDO_NO_T2)
    expect(deriveOutboundMessageId('evt_qualquer', 'reply')).toHaveLength(40)
  })

  it('3. par negativo — OUTRO evento produz OUTRO identificador', () => {
    // Sem este, "id sempre igual" também seria satisfeito por uma constante — e uma constante
    // colaria mensagens diferentes numa só.
    expect(deriveOutboundMessageId('evt_a', 'reply')).not.toBe(
      deriveOutboundMessageId('evt_b', 'reply'),
    )
  })

  it('4. par negativo — o PROPÓSITO entra na chave', () => {
    // Hoje os dois envios de um evento são mutuamente exclusivos (a cortesia de mídia dá `return`
    // antes do motor), então um id por evento bastaria. O discriminante existe para o dia em que
    // deixarem de ser — mesmo desenho de `(sourceEventId, sourceEventKind)` do T5.
    expect(deriveOutboundMessageId('evt_t3a_golden', 'reply')).not.toBe(
      deriveOutboundMessageId('evt_t3a_golden', 'media_courtesy'),
    )
    expect(deriveOutboundMessageId('evt_t3a_golden', 'media_courtesy')).toBe(
      '3EB08CD99C19A562387AD53DD20D6CB79261AAD5',
    )
  })
})
