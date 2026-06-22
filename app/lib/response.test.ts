import { describe, expect, it } from 'vitest'
import { composeAssistantResponse } from './response'
import type { RetrievedChunk } from './retrieval'

const source: RetrievedChunk = {
  fileName: 'precos_servicos.md',
  title: 'Preços e serviços — DGC Hub',
  snippet:
    'Diagnóstico: faixa de R$ 300 a R$ 700. O preço final é definido na proposta, depois do diagnóstico.',
  score: 3,
}

function compose(userMessage: string, sources: RetrievedChunk[], tenantSlug = 'dgc') {
  return composeAssistantResponse({ tenantSlug, userMessage, sources })
}

describe('composeAssistantResponse', () => {
  it('requests human when there are no sources', () => {
    const result = compose('banana espacial', [])

    expect(result.needsHuman).toBe(true)
    expect(result.handoffReason).toBe('no_knowledge_match')
    expect(result.confidence).toBe(0)
    expect(result.sources).toEqual([])
  })

  it('composes a safe response from sources', () => {
    const result = compose('quanto custa o diagnóstico?', [source])

    expect(result.needsHuman).toBe(false)
    expect(result.reply).toContain('R$ 300 a R$ 700')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.sources).toEqual([source])
  })

  it('follows the confidence formula and caps it at 0.95', () => {
    expect(compose('oi', [{ ...source, score: 3 }]).confidence).toBeCloseTo(0.75)
    expect(compose('oi', [{ ...source, score: 100 }]).confidence).toBe(0.95)
  })

  it('strips forbidden claims even if the source contains them', () => {
    const dirty: RetrievedChunk = {
      fileName: 'tom_de_voz.md',
      title: 'Tom de voz',
      snippet: 'Nada de "garantido", "100%", "certeza" nem algo "definitivo".',
      score: 1,
    }
    const reply = compose('como vocês falam?', [dirty]).reply.toLowerCase()

    expect(reply).not.toContain('garantido')
    expect(reply).not.toContain('certeza')
    expect(reply).not.toContain('100%')
    expect(reply).not.toContain('definitivo')
  })

  it('does not quote a closed final price', () => {
    const reply = compose('me dá um valor final fechado', [source]).reply.toLowerCase()

    expect(reply).toContain('valor final')
    expect(reply).toContain('depende')
  })

  it('asks for next-step details on an assistência problem message', () => {
    const reply = compose(
      'minha geladeira parou',
      [source],
      'assistencia-tecnica-demo',
    ).reply.toLowerCase()

    expect(reply).toContain('bairro')
    expect(reply).toContain('equipamento')
  })

  it('limits how much of the snippet it quotes', () => {
    const longSnippet = `${'preço '.repeat(100)}MARCADOR_FINAL`
    const result = compose('quanto custa?', [{ ...source, snippet: longSnippet }])

    expect(result.reply).not.toContain('MARCADOR_FINAL')
  })

  it('uses an assistência-tecnica next step for that tenant', () => {
    const reply = compose(
      'quero agendar uma visita',
      [source],
      'assistencia-tecnica-demo',
    ).reply.toLowerCase()

    expect(reply).toContain('bairro')
  })

  it('uses a consultive next step for the dgc tenant', () => {
    const reply = compose('quero um orçamento', [source], 'dgc').reply.toLowerCase()

    expect(reply).not.toContain('bairro')
    expect(reply).toContain('processo')
  })
})
