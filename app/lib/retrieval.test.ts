import { describe, expect, it } from 'vitest'
import { type KnowledgeDocument, loadKnowledgeBase } from './knowledge.server'
import { retrieveRelevantChunks } from './retrieval'

function makeDoc(fileName: string, title: string, content: string): KnowledgeDocument {
  return { tenantSlug: 't', fileName, title, content }
}

const docs: KnowledgeDocument[] = [
  makeDoc('faq.md', 'FAQ', 'Diagnóstico custa de R$ 300 a R$ 700.'),
  makeDoc('tom.md', 'Tom', 'Responder de forma direta.'),
]

// query útil = ['preco']; score = (no título ? 2 : 0) + (no conteúdo ? 1 : 0)
const rankDocs: KnowledgeDocument[] = [
  makeDoc('d-titulo-conteudo.md', 'Preço', 'tabela de preço aqui'), // 3
  makeDoc('c-titulo.md', 'Preço final', 'sem termo grande aqui'), // 2
  makeDoc('b-conteudo.md', 'Geral', 'fala de preço no texto'), // 1
  makeDoc('a-conteudo.md', 'Outro', 'menciona preço tambem'), // 1
  makeDoc('e-nada.md', 'Nada', 'conteudo irrelevante'), // 0
]

describe('retrieveRelevantChunks', () => {
  it('returns chunks matching query terms', () => {
    const result = retrieveRelevantChunks('quanto custa o diagnóstico?', docs)
    expect(result[0]?.fileName).toBe('faq.md')
    expect(result[0]?.score).toBeGreaterThan(0)
  })

  it('returns empty when there is no useful match', () => {
    const result = retrieveRelevantChunks('banana espacial', docs)
    expect(result).toEqual([])
  })

  it('matches ignoring accents', () => {
    const result = retrieveRelevantChunks('diagnostico', docs)
    expect(result[0]?.fileName).toBe('faq.md')
  })

  it('counts only useful tokens, ignoring stopwords and short words', () => {
    // 'quanto' é stopword, 'o' é curto; só 'custa' conta (no conteúdo do faq) => score 1
    const result = retrieveRelevantChunks('quanto custa o', docs)
    expect(result[0]?.fileName).toBe('faq.md')
    expect(result[0]?.score).toBe(1)
  })

  it('returns [] when the query has only stopwords, short tokens, or is empty', () => {
    expect(retrieveRelevantChunks('que para com uma', docs)).toEqual([])
    expect(retrieveRelevantChunks('a o de', docs)).toEqual([])
    expect(retrieveRelevantChunks('', docs)).toEqual([])
  })

  it('ranks by score descending and breaks ties by fileName ascending', () => {
    const result = retrieveRelevantChunks('preço', rankDocs)
    expect(result.map((chunk) => chunk.fileName)).toEqual([
      'd-titulo-conteudo.md',
      'c-titulo.md',
      'a-conteudo.md',
    ])
  })

  it('limits results to at most 3', () => {
    const result = retrieveRelevantChunks('preço', rankDocs)
    expect(result.length).toBe(3)
  })

  it('scores title matches higher than content-only matches', () => {
    const result = retrieveRelevantChunks('preço', rankDocs)
    expect(result[0]?.score).toBe(3)
    expect(result[1]?.score).toBe(2)
  })

  it('builds a snippet of at most 500 characters', () => {
    const longDoc = makeDoc('long.md', 'Tabela', 'preço '.repeat(200))
    const result = retrieveRelevantChunks('preço', [longDoc])
    expect(result[0]?.snippet.length).toBeGreaterThan(0)
    expect(result[0]?.snippet.length).toBeLessThanOrEqual(500)
  })

  it('retorna a SEÇÃO que casou como snippet, não o começo do documento', () => {
    const doc = makeDoc(
      'servicos.md',
      'Serviços',
      '# Serviços\n\n## Preços\nA visita custa R$ 80.\n\n## Horário\nAbrimos cedo todo dia.',
    )
    const result = retrieveRelevantChunks('visita', [doc])
    expect(result[0]?.title).toBe('Preços')
    expect(result[0]?.snippet).toContain('R$ 80')
    expect(result[0]?.snippet).not.toContain('Abrimos cedo')
  })

  it('pontua por seção — o cabeçalho certo vence o corpo genérico', () => {
    const precos = makeDoc('precos.md', 'Preços', '# Tabela\n\n## Visita\nCusta R$ 80.')
    const generico = makeDoc(
      'tom.md',
      'Tom',
      '# Tom\n\n## Estilo\nFale de visita, custo, preço, atendimento e horário.',
    )
    // 'visita' casa o TÍTULO da seção certa (peso 2) e o corpo do genérico (peso 1).
    const result = retrieveRelevantChunks('visita', [precos, generico])
    expect(result[0]?.fileName).toBe('precos.md')
    expect(result[0]?.title).toBe('Visita')
  })

  it('limita a 1 seção por documento (diversidade de fontes)', () => {
    const multi = makeDoc(
      'multi.md',
      'Multi',
      '# M\n\n## Visita A\nvisita aqui\n\n## Visita B\nvisita ali',
    )
    const outro = makeDoc('outro.md', 'Outro', '# O\n\n## Nota\nvisita também')
    const files = retrieveRelevantChunks('visita', [multi, outro]).map((chunk) => chunk.fileName)
    expect(new Set(files).size).toBe(files.length) // sem arquivo repetido
    expect(files).toContain('multi.md')
    expect(files).toContain('outro.md')
  })

  it('works with real documents loaded by loadKnowledgeBase', async () => {
    const realDocs = await loadKnowledgeBase('dgc')
    const result = retrieveRelevantChunks('quanto custa o diagnóstico?', realDocs)
    expect(result.length).toBeGreaterThan(0)
    expect(result.map((chunk) => chunk.fileName)).toContain('faq.md')
  })
})
