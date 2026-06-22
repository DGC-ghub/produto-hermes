import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type KnowledgeDocument = {
  tenantSlug: string
  fileName: string
  title: string
  content: string
}

const SAFE_SLUG = /^[a-z0-9-]+$/

function extractTitle(content: string, fileName: string): string {
  for (const line of content.split('\n')) {
    if (line.startsWith('# ')) {
      return line.slice(2).trim()
    }
  }
  return fileName
}

/**
 * Carrega os documentos markdown da base de conhecimento de um tenant.
 *
 * Server-side apenas — usa `node:fs`. Não importar em componente React.
 * Retorna `[]` quando a pasta do tenant não existe.
 */
export async function loadKnowledgeBase(tenantSlug: string): Promise<KnowledgeDocument[]> {
  if (!SAFE_SLUG.test(tenantSlug)) {
    throw new Error(`Invalid tenant slug: ${tenantSlug}`)
  }

  const dir = join(process.cwd(), 'knowledge', tenantSlug)

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }

  const markdownFiles = entries.filter((name) => name.endsWith('.md')).sort()

  return Promise.all(
    markdownFiles.map(async (fileName) => {
      const content = await readFile(join(dir, fileName), 'utf8')
      return {
        tenantSlug,
        fileName,
        title: extractTitle(content, fileName),
        content,
      }
    }),
  )
}
