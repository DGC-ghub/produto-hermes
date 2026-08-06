import { describe, expect, it } from 'vitest'
import { conhecimentoDaCandidata, PREFIXO_DA_CANDIDATA } from './preview'

describe('conhecimentoDaCandidata', () => {
  const docs = [
    { title: 'FAQ', content: 'Atendemos de 9h às 18h.' },
    { title: 'Serviços', content: 'Plantão e home care.' },
  ]

  it('devolve o shape que o motor lê', () => {
    expect(conhecimentoDaCandidata('acme', docs)).toEqual([
      {
        tenantSlug: 'acme',
        fileName: `${PREFIXO_DA_CANDIDATA}-1.md`,
        title: 'FAQ',
        content: 'Atendemos de 9h às 18h.',
      },
      {
        tenantSlug: 'acme',
        fileName: `${PREFIXO_DA_CANDIDATA}-2.md`,
        title: 'Serviços',
        content: 'Plantão e home care.',
      },
    ])
  })

  it('o nome do arquivo DIZ que veio da candidata', () => {
    // Esse nome aparece nas fontes ao lado da resposta. É o que separa "isto veio do
    // material em revisão" de "isto veio da base que já está no ar" — um nome neutro
    // esconderia a informação pela qual o simulador existe.
    for (const doc of conhecimentoDaCandidata('acme', docs)) {
      expect(doc.fileName).toContain('candidata')
    }
  })

  it.each([
    ['lista vazia', []],
    ['não é lista', { title: 'x', content: 'y' }],
    ['documento sem título', [{ content: 'só conteúdo' }]],
    ['documento sem conteúdo', [{ title: 'só título' }]],
    ['título que não é texto', [{ title: 42, content: 'ok' }]],
  ])('recusa %s em vez de devolver base vazia', (_rotulo, entrada) => {
    // Devolver `[]` aqui seria pior que lançar: a IA responderia "não sei" a tudo e
    // pareceria burra, quando o defeito é que ninguém validou os artefatos.
    expect(() => conhecimentoDaCandidata('acme', entrada)).toThrow()
  })
})
