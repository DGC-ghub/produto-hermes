import { db } from '../db.server'
import { loadTenantConfig } from './attendant/tenant-config'
import { saveTenantConfigToDb } from './attendant/tenant-config-db.server'
import { loadKnowledgeBase } from './knowledge.server'
import { loadKnowledgeFromDb, writeKnowledgeDoc } from './knowledge-db.server'

// Seed do marco M2.4: leva o config (config/tenants/<slug>.json) e a knowledge
// (knowledge/<slug>/*.md) de ARQUIVO para o BANCO, um tenant por vez. Idempotente: só popula o
// que ainda não existe no banco (não sobrescreve edições feitas via tela). É o passo do cutover
// que precede a virada dos callers pra fonte-banco. Tenant sem arquivo é pulado em silêncio.

export type SeedResult = { configs: number; docs: number; tenants: string[] }

// `slugs` opcional limita o seed a tenants específicos (usado nos testes para não colidir com
// tenants de suítes paralelas no .test.db compartilhado); sem ele, processa todos (o cutover).
export async function seedConfigAndKnowledgeToDb(slugs?: string[]): Promise<SeedResult> {
  const tenants = await db.tenant.findMany({
    where: slugs ? { slug: { in: slugs } } : undefined,
    include: { configRecord: true },
  })
  const touched: string[] = []
  let configs = 0
  let docs = 0

  for (const tenant of tenants) {
    let didSomething = false

    // Config: só se o banco ainda não tem um registro para este tenant.
    if (!tenant.configRecord) {
      try {
        await saveTenantConfigToDb(loadTenantConfig(tenant.slug))
        configs++
        didSomething = true
      } catch {
        // Sem arquivo de config (ou inválido) — nada a semear para este tenant.
      }
    }

    // Knowledge: só se o banco ainda não tem docs para este tenant.
    const existing = await loadKnowledgeFromDb(tenant.slug)
    if (existing.length === 0) {
      const fromFiles = await loadKnowledgeBase(tenant.slug)
      let position = 0
      for (const doc of fromFiles) {
        await writeKnowledgeDoc(tenant.slug, {
          title: doc.title,
          content: doc.content,
          position: position++,
        })
        docs++
        didSomething = true
      }
    }

    if (didSomething) {
      touched.push(tenant.slug)
    }
  }

  return { configs, docs, tenants: touched }
}
