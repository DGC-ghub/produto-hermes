import { describe, expect, it } from 'vitest'
import { conhecimentoDaCandidata, contactIdDoPreview, PREFIXO_DA_CANDIDATA } from './preview'

describe('contactIdDoPreview (§10.3)', () => {
  it('junta conta, versão e geração', () => {
    expect(contactIdDoPreview('acc-1', 'ver-9', 2)).toBe('simulator:acc-1:ver-9:2')
  })

  it('a GERAÇÃO separa os ciclos', () => {
    // O par que importa: sem a geração no id, o histórico da candidata reprovada seguiria
    // vivo na corrigida, e a pessoa avaliaria a resposta nova lendo o contexto da antiga.
    expect(contactIdDoPreview('acc-1', 'ver-9', 1)).not.toBe(
      contactIdDoPreview('acc-1', 'ver-9', 2),
    )
  })

  it('a CONTA separa dois sócios da mesma empresa', () => {
    expect(contactIdDoPreview('acc-1', 'ver-9', 2)).not.toBe(
      contactIdDoPreview('acc-2', 'ver-9', 2),
    )
  })

  it('a VERSÃO separa candidatas diferentes', () => {
    expect(contactIdDoPreview('acc-1', 'ver-9', 2)).not.toBe(
      contactIdDoPreview('acc-1', 'ver-10', 2),
    )
  })
})

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
