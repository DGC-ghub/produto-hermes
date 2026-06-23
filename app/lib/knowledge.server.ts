import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type KnowledgeDocument = {
  tenantSlug: string
  fileName: string
  title: string
  content: string
}

const SAFE_SLUG = /^[a-z0-9-]+$/
const SAFE_SOURCE = /^knowledge\/[a-z0-9-]+$/

function extractTitle(content: string, fileName: string): string {
  for (const line of content.split('\n')) {
    if (line.startsWith('# ')) {
      return line.slice(2).trim()
    }
  }
  return fileName
}

/**
 * Carrega os documentos markdown de uma pasta de conhecimento (ex.: "knowledge/<slug>").
 * O caminho vem do TenantConfig (`knowledge.sourceDir`). Server-side — usa node:fs.
 * Valida o caminho (sem path traversal) e retorna [] quando a pasta não existe.
 */
export async function loadKnowledgeFromSource(sourceDir: string): Promise<KnowledgeDocument[]> {
  if (!SAFE_SOURCE.test(sourceDir)) {
    throw new Error(`Invalid knowledge source: ${sourceDir}`)
  }
  const tenantSlug = sourceDir.slice('knowledge/'.length)
  const dir = join(process.cwd(), sourceDir)

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

/**
 * Compatibilidade: carrega a base por slug (`knowledge/<slug>`). Wrapper de
 * loadKnowledgeFromSource. Não importar em componente React.
 */
export async function loadKnowledgeBase(tenantSlug: string): Promise<KnowledgeDocument[]> {
  if (!SAFE_SLUG.test(tenantSlug)) {
    throw new Error(`Invalid tenant slug: ${tenantSlug}`)
  }
  return loadKnowledgeFromSource(`knowledge/${tenantSlug}`)
}
