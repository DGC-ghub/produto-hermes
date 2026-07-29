import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import { postSignupPath, registerOwner, resendVerification, slugify } from './signup.server'

// O provedor de e-mail é falível (sem chave, domínio recusado, rede fora). Aqui ele é um botão
// no teste: o que importa é o que o cadastro FAZ com o resultado do envio.
const mailer = vi.hoisted(() => ({ sent: true, calls: 0 }))
vi.mock('./email.server', () => ({
  sendEmail: async () => {
    mailer.calls += 1
    return { sent: mailer.sent }
  },
}))

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
beforeEach(() => {
  mailer.sent = true
  mailer.calls = 0
})

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

  it('envio OK: diz que o e-mail saiu e manda o dono para o painel', async () => {
    const r = await registerOwner({
      companyName: NAME,
      email: EMAIL,
      password: 'senha1234',
      baseUrl: 'https://x.test',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.emailSent).toBe(true)
    expect(postSignupPath(r)).toBe('/atendente')
  })

  it('envio falhando: a conta nasce mesmo assim, mas a flag chega na tela', async () => {
    mailer.sent = false
    const r = await registerOwner({
      companyName: NAME,
      email: EMAIL,
      password: 'senha1234',
      baseUrl: 'https://x.test',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // O cadastro não pode falhar por causa do provedor de e-mail — mas também não pode mentir.
    expect(r.emailSent).toBe(false)
    expect(postSignupPath(r)).toBe('/verificar-email?envio=falhou')

    const acc = await db.account.findUnique({ where: { email: EMAIL } })
    expect(acc?.emailVerifyToken).not.toBeNull() // token gravado: o reenvio é possível
  })
})

describe('resendVerification (reenvio da confirmação)', () => {
  it('reenvia até o teto da janela, segura o excedente e volta depois que ela vence', async () => {
    const r = await registerOwner({
      companyName: NAME,
      email: EMAIL,
      password: 'senha1234',
      baseUrl: 'https://x.test',
    })
    if (!r.ok) throw new Error(`preparo do teste falhou: ${r.error}`)
    const account = { id: r.accountId, email: r.email }
    const t0 = Date.now()
    const sentBefore = mailer.calls // o cadastro já disparou um

    expect((await resendVerification(account, 'https://x.test', t0)).ok).toBe(true)
    expect((await resendVerification(account, 'https://x.test', t0 + 1_000)).ok).toBe(true)
    expect((await resendVerification(account, 'https://x.test', t0 + 2_000)).ok).toBe(true)

    const excess = await resendVerification(account, 'https://x.test', t0 + 3_000)
    expect(excess.ok).toBe(false)
    if (excess.ok) return
    expect(excess.retryAfterSec).toBeGreaterThan(0)
    expect(mailer.calls).toBe(sentBefore + 3) // o excedente não virou e-mail

    const later = await resendVerification(account, 'https://x.test', t0 + 11 * 60_000)
    expect(later.ok).toBe(true)
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
