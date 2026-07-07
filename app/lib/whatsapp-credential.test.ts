import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { ensureTenant } from './tenants.server'
import { registerWhatsappNumber } from './whatsapp.server'
import { resolveWhatsappCredential, setWhatsappCredential } from './whatsapp-credential.server'

// Segredo estável pra cifra durante os testes (crypto.server deriva a chave dele).
const SECRET = 'test-session-secret-m4-cifra-por-tenant'
const ORIGINAL = { ...process.env }

const WA_TENANT = 'zzz-test-wacred-tenant'
const WA_PHONE = 'WACRED_TEST_1'

beforeAll(async () => {
  await ensureTenant({ slug: WA_TENANT, name: 'WA Cred Tenant' })
})
beforeEach(() => {
  process.env.SESSION_SECRET = SECRET
})
afterEach(async () => {
  process.env = { ...ORIGINAL }
  await db.whatsappNumber.deleteMany({ where: { phoneNumberId: { startsWith: 'WACRED_TEST_' } } })
})
afterAll(async () => {
  await db.whatsappNumber.deleteMany({ where: { tenant: { slug: WA_TENANT } } })
  await db.tenant.deleteMany({ where: { slug: WA_TENANT } })
})

describe('resolveWhatsappCredential (banco cifrado → env fallback)', () => {
  it('sem registro no banco → usa token/secret do env', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token-abc'
    process.env.WHATSAPP_APP_SECRET = 'env-secret-xyz'
    const cred = await resolveWhatsappCredential('WACRED_TEST_INEXISTENTE')
    expect(cred.accessToken).toBe('env-token-abc')
    expect(cred.appSecret).toBe('env-secret-xyz')
  })

  it('número registrado mas sem credencial própria → cai no env', async () => {
    await registerWhatsappNumber(WA_PHONE, WA_TENANT)
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token-abc'
    const cred = await resolveWhatsappCredential(WA_PHONE)
    expect(cred.accessToken).toBe('env-token-abc')
  })

  it('credencial própria no banco vence o env', async () => {
    await registerWhatsappNumber(WA_PHONE, WA_TENANT)
    await setWhatsappCredential(WA_PHONE, {
      accessToken: 'token-do-tenant',
      appSecret: 'secret-do-tenant',
    })
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token-abc'
    process.env.WHATSAPP_APP_SECRET = 'env-secret-xyz'
    const cred = await resolveWhatsappCredential(WA_PHONE)
    expect(cred.accessToken).toBe('token-do-tenant')
    expect(cred.appSecret).toBe('secret-do-tenant')
  })

  it('guarda cifrado em repouso — o texto claro NÃO aparece na coluna', async () => {
    await registerWhatsappNumber(WA_PHONE, WA_TENANT)
    await setWhatsappCredential(WA_PHONE, { accessToken: 'token-super-secreto-123' })
    const row = await db.whatsappNumber.findUnique({
      where: { phoneNumberId: WA_PHONE },
      select: { accessTokenEnc: true },
    })
    expect(row?.accessTokenEnc).toBeTruthy()
    expect(row?.accessTokenEnc).not.toContain('token-super-secreto-123')
    expect(row?.accessTokenEnc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/) // iv:tag:cipher
  })

  it('credencial ilegível (SESSION_SECRET mudou) → null, sem vazar pro env (fail-safe)', async () => {
    await registerWhatsappNumber(WA_PHONE, WA_TENANT)
    await setWhatsappCredential(WA_PHONE, { accessToken: 'token-do-tenant' })
    // Simula troca de segredo: o mesmo ciphertext não abre mais.
    process.env.SESSION_SECRET = 'outro-secret-totalmente-diferente'
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token-abc'
    const cred = await resolveWhatsappCredential(WA_PHONE)
    expect(cred.accessToken).toBeNull() // NÃO cai no env — o campo existe mas não abre
  })

  it('null limpa a credencial (volta a usar o env)', async () => {
    await registerWhatsappNumber(WA_PHONE, WA_TENANT)
    await setWhatsappCredential(WA_PHONE, { accessToken: 'token-do-tenant' })
    await setWhatsappCredential(WA_PHONE, { accessToken: null })
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token-abc'
    const cred = await resolveWhatsappCredential(WA_PHONE)
    expect(cred.accessToken).toBe('env-token-abc')
  })
})

describe('setWhatsappCredential', () => {
  it('rejeita número não registrado', async () => {
    await expect(
      setWhatsappCredential('WACRED_TEST_NAO_EXISTE', { accessToken: 'x' }),
    ).rejects.toThrow('não registrado')
  })

  it('undefined mantém o outro campo (só troca o que foi passado)', async () => {
    await registerWhatsappNumber(WA_PHONE, WA_TENANT)
    await setWhatsappCredential(WA_PHONE, { accessToken: 'tok-1', appSecret: 'sec-1' })
    await setWhatsappCredential(WA_PHONE, { accessToken: 'tok-2' }) // não mexe no appSecret
    const cred = await resolveWhatsappCredential(WA_PHONE)
    expect(cred.accessToken).toBe('tok-2')
    expect(cred.appSecret).toBe('sec-1')
  })
})
