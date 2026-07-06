import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { loadKnowledgeFromDb, writeKnowledgeDoc } from './knowledge-db.server'

const SLUG = 'zzz-m22-kb'

afterEach(async () => {
  const tenant = await db.tenant.findUnique({ where: { slug: SLUG } })
  if (tenant) {
    await db.knowledgeDoc.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.delete({ where: { id: tenant.id } })
  }
})

describe('knowledge no banco (M2.2)', () => {
  it('write cria e load devolve ordenado por position, no shape KnowledgeDocument', async () => {
    await db.tenant.create({ data: { slug: SLUG, name: 'M22 KB' } })
    await writeKnowledgeDoc(SLUG, { title: 'Segundo', content: 'conteúdo B', position: 2 })
    await writeKnowledgeDoc(SLUG, {
      title: 'Primeiro',
      content: '# Primeiro\nconteúdo A',
      position: 1,
    })

    const docs = await loadKnowledgeFromDb(SLUG)
    expect(docs).toHaveLength(2)
    expect(docs[0]?.title).toBe('Primeiro') // position 1 vem antes
    expect(docs[0]?.tenantSlug).toBe(SLUG)
    expect(docs[0]?.content).toContain('conteúdo A')
    expect(docs[1]?.title).toBe('Segundo')
  })

  it('write exige título e conteúdo', async () => {
    await db.tenant.create({ data: { slug: SLUG, name: 'M22 KB' } })
    await expect(writeKnowledgeDoc(SLUG, { title: '', content: 'x' })).rejects.toThrow()
  })

  it('load devolve [] para tenant sem docs', async () => {
    await db.tenant.create({ data: { slug: SLUG, name: 'M22 KB' } })
    expect(await loadKnowledgeFromDb(SLUG)).toEqual([])
  })
})
