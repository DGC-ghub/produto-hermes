import { afterEach, describe, expect, it, vi } from 'vitest'
import { decryptSecret, encryptSecret } from './crypto.server'

afterEach(() => vi.unstubAllEnvs())

describe('cifra de segredos (M4)', () => {
  it('roundtrip: decrypt(encrypt(x)) === x', () => {
    const secret = 'EAAG-token-do-whatsapp-super-secreto-123'
    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })

  it('duas cifras do mesmo texto são diferentes (IV aleatório) mas decifram igual', () => {
    const a = encryptSecret('mesmo-texto')
    const b = encryptSecret('mesmo-texto')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('mesmo-texto')
    expect(decryptSecret(b)).toBe('mesmo-texto')
  })

  it('texto cifrado adulterado → lança (tag GCM detecta)', () => {
    const enc = encryptSecret('confidencial')
    const [iv, tag, data] = enc.split(':')
    // Trocar o último hex por um valor FIXO não adultera nada quando a cifra já termina
    // nele — e o IV é aleatório, então isso acontecia uma vez a cada 256 rodadas e o teste
    // passava sem ter testado. Aqui o dígito muda sempre.
    const ultimo = data.slice(-1)
    const adulterado = `${iv}:${tag}:${data.slice(0, -1)}${ultimo === '0' ? '1' : '0'}`
    expect(adulterado).not.toBe(enc)
    expect(() => decryptSecret(adulterado)).toThrow()
  })

  it('formato inválido → lança', () => {
    expect(() => decryptSecret('nao-e-um-segredo')).toThrow()
  })

  it('context (AAD) amarra a cifra ao escopo — roundtrip com o mesmo context', () => {
    const enc = encryptSecret('token-do-tenant-A', 'tenant:aaa')
    expect(decryptSecret(enc, 'tenant:aaa')).toBe('token-do-tenant-A')
  })

  it('decifrar com context de OUTRO tenant → lança (anti confused-deputy)', () => {
    const enc = encryptSecret('token-do-tenant-A', 'tenant:aaa')
    expect(() => decryptSecret(enc, 'tenant:bbb')).toThrow()
    expect(() => decryptSecret(enc, '')).toThrow() // sem context também falha
  })
})

describe('decouple da chave de cifra do SESSION_SECRET (#2, sem rotação)', () => {
  it('SECRETS_ENCRYPTION_KEY definida vira a chave (desacopla do cookie)', () => {
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', 'chave-de-cifra-propria-X')
    const enc = encryptSecret('segredo')
    expect(decryptSecret(enc)).toBe('segredo')
    // trocar a chave PRÓPRIA → não decifra: prova que a chave vem dela, não do SESSION_SECRET
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', 'outra-chave-Y')
    expect(() => decryptSecret(enc)).toThrow()
  })

  it('sem SECRETS_ENCRYPTION_KEY: cai no SESSION_SECRET (compat — nada re-cifra)', () => {
    vi.stubEnv('SECRETS_ENCRYPTION_KEY', '')
    expect(decryptSecret(encryptSecret('compat'))).toBe('compat')
  })
})
