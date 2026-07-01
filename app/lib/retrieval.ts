import type { KnowledgeDocument } from './knowledge.server'

export type RetrievedChunk = {
  fileName: string
  title: string
  snippet: string
  score: number
}

const STOPWORDS = new Set([
  'que',
  'para',
  'com',
  'uma',
  'como',
  'qual',
  'quanto',
  'pela',
  'pelo',
  'dos',
  'das',
  'você',
  'vocês',
  'tem',
  'mais',
])

const MAX_RESULTS = 3
const MAX_SNIPPET_LENGTH = 500
const TITLE_MATCH_SCORE = 2
const CONTENT_MATCH_SCORE = 1

// Linha de cabeçalho markdown (# … ######). O texto capturado vira o título da seção.
const HEADING_RE = /^#{1,6}\s+(.*)$/

// Um pedaço pontuável do documento: o cabeçalho da seção + o corpo dela. Antes o
// documento inteiro era a unidade — o que deixava docs longos e genéricos (tom de
// voz, handoff) dominarem qualquer pergunta e escondia a passagem certa no meio.
type Chunk = { title: string; text: string }

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

// Quebra o documento em seções pelos cabeçalhos markdown. O conteúdo antes do 1º
// cabeçalho (ou um doc sem cabeçalhos) vira um único chunk com o título do doc —
// isso preserva o comportamento anterior para bases "planas".
function splitIntoChunks(doc: KnowledgeDocument): Chunk[] {
  const chunks: Chunk[] = []
  let currentTitle = doc.title
  let buffer: string[] = []

  const flush = () => {
    const text = buffer.join('\n').trim()
    if (text.length > 0) {
      chunks.push({ title: currentTitle, text })
    }
    buffer = []
  }

  for (const line of doc.content.split('\n')) {
    const heading = line.match(HEADING_RE)
    if (heading) {
      flush()
      currentTitle = heading[1].trim() || doc.title
    } else {
      buffer.push(line)
    }
  }
  flush()

  // Doc só com cabeçalhos (sem corpo) ainda deve ser pontuável pelo próprio texto.
  if (chunks.length === 0 && doc.content.trim().length > 0) {
    chunks.push({ title: doc.title, text: doc.content.trim() })
  }
  return chunks
}

// Stopwords comparadas já normalizadas (sem acento), pois os tokens chegam normalizados.
const NORMALIZED_STOPWORDS = new Set([...STOPWORDS].map(normalizeText))

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !NORMALIZED_STOPWORDS.has(token))
}

function buildSnippet(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET_LENGTH)
}

/**
 * Retrieval simples e determinístico: dada uma pergunta e os documentos de um tenant,
 * retorna os trechos (SEÇÕES) mais relevantes. O snippet é a passagem que casou — não
 * mais o começo do documento. Função pura — sem banco, fs, API ou LLM.
 */
export function retrieveRelevantChunks(query: string, docs: KnowledgeDocument[]): RetrievedChunk[] {
  const queryTokens = [...new Set(tokenize(query))]
  if (queryTokens.length === 0) {
    return []
  }

  const scored: RetrievedChunk[] = []
  for (const doc of docs) {
    for (const chunk of splitIntoChunks(doc)) {
      const titleTokens = new Set(tokenize(chunk.title))
      const textTokens = new Set(tokenize(chunk.text))
      let score = 0
      for (const token of queryTokens) {
        if (titleTokens.has(token)) {
          score += TITLE_MATCH_SCORE
        }
        if (textTokens.has(token)) {
          score += CONTENT_MATCH_SCORE
        }
      }
      if (score > 0) {
        scored.push({
          fileName: doc.fileName,
          title: chunk.title,
          snippet: buildSnippet(chunk.text),
          score,
        })
      }
    }
  }

  const ranked = scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    if (a.fileName !== b.fileName) {
      return a.fileName < b.fileName ? -1 : 1
    }
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0
  })

  // Cota de diversidade: no máximo 1 seção por documento. Sem isto, um doc longo
  // com várias seções fracas ocupa todas as vagas e esconde a fonte certa.
  const result: RetrievedChunk[] = []
  const seenFiles = new Set<string>()
  for (const chunk of ranked) {
    if (seenFiles.has(chunk.fileName)) {
      continue
    }
    seenFiles.add(chunk.fileName)
    result.push(chunk)
    if (result.length >= MAX_RESULTS) {
      break
    }
  }
  return result
}
