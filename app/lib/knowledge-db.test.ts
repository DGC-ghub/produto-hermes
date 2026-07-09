import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import {
  deleteKnowledgeDoc,
  listKnowledgeDocs,
  loadKnowledgeFromDb,
  resolveKnowledge,
  writeKnowledgeDoc,
} from './knowledge-db.server'

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

describe('resolveKnowledge — estratégia C (M2.5)', () => {
  it('usa o BANCO quando o tenant tem docs', async () => {
    await db.tenant.create({ data: { slug: SLUG, name: 'M22 KB' } })
    await writeKnowledgeDoc(SLUG, { title: 'Do Banco', content: 'conteúdo' })
    const docs = await resolveKnowledge(SLUG, `knowledge/${SLUG}`)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.title).toBe('Do Banco')
  })

  it('cai no arquivo quando o banco não tem docs (pasta inexistente → [])', async () => {
    await db.tenant.create({ data: { slug: SLUG, name: 'M22 KB' } })
    expect(await resolveKnowledge(SLUG, `knowledge/${SLUG}`)).toEqual([])
  })
})

describe('listKnowledgeDocs + deleteKnowledgeDoc (gestão pela tela — Tier 1)', () => {
  it('list devolve os docs com id real, ordenados por position', async () => {
    await db.tenant.create({ data: { slug: SLUG, name: 'M22 KB' } })
    await writeKnowledgeDoc(SLUG, { title: 'B', content: 'bbb', position: 2 })
    await writeKnowledgeDoc(SLUG, { title: 'A', content: 'aaa', position: 1 })
    const rows = await listKnowledgeDocs(SLUG)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.title).toBe('A') // position 1 primeiro
    expect(typeof rows[0]?.id).toBe('string')
    expect(rows[0]?.id).toBeTruthy() // id real, pra editar/remover
  })

  it('write com id edita o doc existente (não cria outro)', async () => {
    await db.tenant.create({ data: { slug: SLUG, name: 'M22 KB' } })
    await writeKnowledgeDoc(SLUG, { title: 'Original', content: 'v1' })
    const first = (await listKnowledgeDocs(SLUG))[0]
    await writeKnowledgeDoc(SLUG, { id: first?.id, title: 'Editado', content: 'v2' })
    const rows = await listKnowledgeDocs(SLUG)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Editado')
    expect(rows[0]?.content).toBe('v2')
  })

  it('delete remove o doc do tenant', async () => {
    await db.tenant.create({ data: { slug: SLUG, name: 'M22 KB' } })
    await writeKnowledgeDoc(SLUG, { title: 'X', content: 'xxx' })
    const doc = (await listKnowledgeDocs(SLUG))[0]
    if (doc) {
      await deleteKnowledgeDoc(SLUG, doc.id)
    }
    expect(await listKnowledgeDocs(SLUG)).toEqual([])
  })

  it('delete de id que não é do tenant lança (escopo multi-tenant)', async () => {
    await db.tenant.create({ data: { slug: SLUG, name: 'M22 KB' } })
    await expect(deleteKnowledgeDoc(SLUG, 'id-de-outro-ou-inexistente')).rejects.toThrow()
  })
})
