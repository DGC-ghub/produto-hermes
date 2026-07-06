import { db } from '../db.server'
import { type KnowledgeDocument, loadKnowledgeFromSource } from './knowledge.server'

// Acesso à knowledge pelo BANCO (marco M2.2). Retorna o MESMO shape KnowledgeDocument de
// loadKnowledgeBase (arquivo), pra ser drop-in — knowledge já era async, então trocar o caller
// é de baixo risco. O dono edita docs pela tela (writeKnowledgeDoc) em vez de subir arquivo.

const SAFE_SLUG = /^[a-z0-9-]+$/

/** Carrega os docs de conhecimento do tenant, ordenados por position. Shape compatível. */
export async function loadKnowledgeFromDb(tenantSlug: string): Promise<KnowledgeDocument[]> {
  if (!SAFE_SLUG.test(tenantSlug)) {
    throw new Error(`Invalid tenant slug: ${tenantSlug}`)
  }
  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    include: { knowledgeDocs: { orderBy: { position: 'asc' } } },
  })
  if (!tenant) {
    return []
  }
  return tenant.knowledgeDocs.map((doc) => ({
    tenantSlug,
    fileName: `${doc.id}.md`, // pseudo-nome estável (o banco não tem arquivo)
    title: doc.title,
    content: doc.content,
  }))
}

/**
 * Cria (sem `id`) ou atualiza (com `id`) um doc de conhecimento do tenant. O update é escopado
 * por tenantId — nunca mexe no doc de outra empresa. Server-side.
 */
export async function writeKnowledgeDoc(
  tenantSlug: string,
  input: { id?: string; title: string; content: string; position?: number },
): Promise<void> {
  if (!SAFE_SLUG.test(tenantSlug)) {
    throw new Error(`Invalid tenant slug: ${tenantSlug}`)
  }
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } })
  if (!tenant) {
    throw new Error(`Tenant não encontrado: ${tenantSlug}`)
  }
  const title = input.title.trim()
  const content = input.content.trim()
  if (!title || !content) {
    throw new Error('Documento de conhecimento precisa de título e conteúdo.')
  }
  const position = input.position ?? 0
  if (input.id) {
    const updated = await db.knowledgeDoc.updateMany({
      where: { id: input.id, tenantId: tenant.id }, // escopo multi-tenant
      data: { title, content, position },
    })
    if (updated.count === 0) {
      throw new Error('Documento não encontrado neste tenant.')
    }
  } else {
    await db.knowledgeDoc.create({
      data: { tenantId: tenant.id, title, content, position },
    })
  }
}

/**
 * Estratégia C do marco M2.5: resolve a knowledge do tenant pelo BANCO primeiro; se o tenant
 * ainda não tem docs no banco, cai no ARQUIVO (sourceDir, ex.: "knowledge/<slug>"). Mesmo shape.
 */
export async function resolveKnowledge(
  slug: string,
  sourceDir: string,
): Promise<KnowledgeDocument[]> {
  const fromDb = await loadKnowledgeFromDb(slug)
  if (fromDb.length > 0) {
    return fromDb
  }
  return loadKnowledgeFromSource(sourceDir)
}
