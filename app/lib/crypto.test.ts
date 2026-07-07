import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from './crypto.server'

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
    const adulterado = `${iv}:${tag}:${data.slice(0, -2)}00`
    expect(() => decryptSecret(adulterado)).toThrow()
  })

  it('formato inválido → lança', () => {
    expect(() => decryptSecret('nao-e-um-segredo')).toThrow()
  })
})
