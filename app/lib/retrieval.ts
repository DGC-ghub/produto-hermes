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

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
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
 * retorna os trechos mais relevantes. Função pura — sem banco, fs, API ou LLM.
 */
export function retrieveRelevantChunks(query: string, docs: KnowledgeDocument[]): RetrievedChunk[] {
  const queryTokens = [...new Set(tokenize(query))]
  if (queryTokens.length === 0) {
    return []
  }

  return docs
    .map((doc) => {
      const titleTokens = new Set(tokenize(doc.title))
      const contentTokens = new Set(tokenize(doc.content))
      let score = 0
      for (const token of queryTokens) {
        if (titleTokens.has(token)) {
          score += TITLE_MATCH_SCORE
        }
        if (contentTokens.has(token)) {
          score += CONTENT_MATCH_SCORE
        }
      }
      return { doc, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }
      if (a.doc.fileName < b.doc.fileName) {
        return -1
      }
      return a.doc.fileName > b.doc.fileName ? 1 : 0
    })
    .slice(0, MAX_RESULTS)
    .map(({ doc, score }) => ({
      fileName: doc.fileName,
      title: doc.title,
      snippet: buildSnippet(doc.content),
      score,
    }))
}
