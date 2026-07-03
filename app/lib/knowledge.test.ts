import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadKnowledgeBase } from './knowledge.server'

describe('loadKnowledgeBase', () => {
  it('loads markdown documents for a tenant', async () => {
    const docs = await loadKnowledgeBase('dgc')

    expect(docs.length).toBeGreaterThan(0)
    expect(docs[0]).toHaveProperty('tenantSlug', 'dgc')
    expect(docs.some((doc) => doc.fileName === 'faq.md')).toBe(true)
  })

  it('loads documents for the assistencia-tecnica-demo tenant', async () => {
    const docs = await loadKnowledgeBase('assistencia-tecnica-demo')

    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((doc) => doc.tenantSlug === 'assistencia-tecnica-demo')).toBe(true)
    expect(docs.some((doc) => doc.fileName === 'servicos_precos.md')).toBe(true)
  })

  it('returns documents sorted by fileName', async () => {
    const docs = await loadKnowledgeBase('dgc')
    const fileNames = docs.map((doc) => doc.fileName)
    const sorted = [...fileNames].sort()

    expect(fileNames).toEqual(sorted)
  })

  it('extracts the title from the first "# " heading', async () => {
    const docs = await loadKnowledgeBase('dgc')
    const faq = docs.find((doc) => doc.fileName === 'faq.md')

    expect(faq?.title).toBe('FAQ — DGC Hub')
  })

  it('returns an empty array for a non-existent tenant', async () => {
    const docs = await loadKnowledgeBase('tenant-que-nao-existe')

    expect(docs).toEqual([])
  })

  it('rejects unsafe tenant slugs', async () => {
    await expect(loadKnowledgeBase('../dgc')).rejects.toThrow('Invalid tenant slug')
    await expect(loadKnowledgeBase('DGC')).rejects.toThrow('Invalid tenant slug')
    await expect(loadKnowledgeBase('abc_def')).rejects.toThrow('Invalid tenant slug')
  })

  describe('with a controlled fixture tenant', () => {
    const fixtureSlug = 'zzz-test-fixture'
    const fixtureDir = join(process.cwd(), 'knowledge', fixtureSlug)

    beforeAll(async () => {
      await rm(fixtureDir, { recursive: true, force: true })
      await mkdir(fixtureDir, { recursive: true })
      await writeFile(join(fixtureDir, 'a-com-titulo.md'), '# Título A\n\nconteúdo do A\n')
      await writeFile(join(fixtureDir, 'b-sem-titulo.md'), 'sem heading aqui\n')
      await writeFile(join(fixtureDir, 'ignorar.txt'), 'isto não é markdown\n')
    })

    afterAll(async () => {
      await rm(fixtureDir, { recursive: true, force: true })
    })

    it('uses the fileName as title when there is no "# " heading', async () => {
      const docs = await loadKnowledgeBase(fixtureSlug)
      const noTitle = docs.find((doc) => doc.fileName === 'b-sem-titulo.md')

      expect(noTitle?.title).toBe('b-sem-titulo.md')
    })

    it('ignores files that are not markdown', async () => {
      const docs = await loadKnowledgeBase(fixtureSlug)

      expect(docs.map((doc) => doc.fileName)).toEqual(['a-com-titulo.md', 'b-sem-titulo.md'])
    })
  })
})
