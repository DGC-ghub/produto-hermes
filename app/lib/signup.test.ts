import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { registerOwner, slugify } from './signup.server'

const NAME = 'ZZZ M26 Signup Ltda'
const SLUG = 'zzz-m26-signup-ltda'
const EMAIL = 'zzz-m26-signup@owner.local'

async function cleanup() {
  const tenants = await db.tenant.findMany({ where: { slug: { startsWith: 'zzz-m26' } } })
  for (const t of tenants) {
    await db.membership.deleteMany({ where: { tenantId: t.id } })
    await db.tenantConfigRecord.deleteMany({ where: { tenantId: t.id } })
    await db.knowledgeDoc.deleteMany({ where: { tenantId: t.id } })
    await db.subscription.deleteMany({ where: { tenantId: t.id } })
    await db.tenant.delete({ where: { id: t.id } })
  }
  await db.account.deleteMany({ where: { email: { in: [EMAIL, 'zzz-m26-outro@x.local'] } } })
}
afterEach(cleanup)

describe('slugify', () => {
  it('normaliza acentos, espaços e símbolos', () => {
    expect(slugify('Carvalho Serviços Médicos')).toBe('carvalho-servicos-medicos')
    expect(slugify('  Açaí & Cia!! ')).toBe('acai-cia')
  })
})

describe('registerOwner (M2.6b)', () => {
  it('cadastra: cria tenant + account owner + dispara token de verificação', async () => {
    const r = await registerOwner({
      companyName: NAME,
      email: EMAIL,
      password: 'senha1234',
      baseUrl: 'https://x.test',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.slug).toBe(SLUG)

    const tenant = await db.tenant.findUnique({
      where: { slug: SLUG },
      include: { memberships: true },
    })
    expect(tenant?.memberships[0]?.role).toBe('owner')
    const acc = await db.account.findUnique({ where: { email: EMAIL } })
    expect(acc?.emailVerifyToken).not.toBeNull() // verificação disparada
    expect(acc?.emailVerifiedAt).toBeNull()

    const sub = await db.subscription.findUnique({ where: { tenantId: tenant?.id ?? '' } })
    expect(sub?.status).toBe('trialing') // trial de 14 dias no cadastro
  })

  it('rejeita e-mail inválido', async () => {
    const r = await registerOwner({
      companyName: NAME,
      email: 'semArroba',
      password: 'senha1234',
      baseUrl: 'x',
    })
    expect(r.ok).toBe(false)
  })

  it('rejeita senha curta', async () => {
    const r = await registerOwner({
      companyName: NAME,
      email: EMAIL,
      password: '123',
      baseUrl: 'x',
    })
    expect(r.ok).toBe(false)
  })

  it('rejeita nome de empresa duplicado', async () => {
    await registerOwner({ companyName: NAME, email: EMAIL, password: 'senha1234', baseUrl: 'x' })
    const r = await registerOwner({
      companyName: NAME,
      email: 'zzz-m26-outro@x.local',
      password: 'senha1234',
      baseUrl: 'x',
    })
    expect(r.ok).toBe(false)
  })

  it('rejeita e-mail já cadastrado', async () => {
    await registerOwner({ companyName: NAME, email: EMAIL, password: 'senha1234', baseUrl: 'x' })
    const r = await registerOwner({
      companyName: 'ZZZ M26 Signup Outra',
      email: EMAIL,
      password: 'senha1234',
      baseUrl: 'x',
    })
    expect(r.ok).toBe(false)
  })
})
