import { initAuthCreds } from '@whiskeysockets/baileys'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deserializeAuthState, serializeAuthState } from './baileys-auth.server'

const ORIGINAL_ENV = { ...process.env }

describe('auth-state do Baileys (serialize/deserialize)', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-auth-state-hermes-0123456789'
  })
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('roundtrip preserva os Buffers das chaves (BufferJSON) e as keys da sessão', () => {
    const creds = initAuthCreds()
    const keys = {
      'pre-key': { '1': { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5, 6]) } },
    }
    const enc = serializeAuthState(creds, keys, 'sess-1')
    const back = deserializeAuthState(enc, 'sess-1')

    // Buffer de creds volta como Buffer (não como {type:'Buffer',data:[...]}).
    expect(Buffer.isBuffer(back.creds.noiseKey.private)).toBe(true)
    expect(back.creds.noiseKey.private).toEqual(creds.noiseKey.private)
    expect(back.creds.registrationId).toBe(creds.registrationId)

    // As keys da sessão Signal sobrevivem com os Buffers intactos.
    const preKey = back.keys['pre-key']['1'] as { public: Buffer; private: Buffer }
    expect(Buffer.isBuffer(preKey.public)).toBe(true)
    expect(preKey.public).toEqual(Buffer.from([1, 2, 3]))
    expect(preKey.private).toEqual(Buffer.from([4, 5, 6]))
  })

  it('cifra é por-sessão (AAD): decifrar com outro sessionId falha', () => {
    const enc = serializeAuthState(initAuthCreds(), {}, 'sess-A')
    expect(() => deserializeAuthState(enc, 'sess-B')).toThrow()
    // e com o certo, abre.
    expect(() => deserializeAuthState(enc, 'sess-A')).not.toThrow()
  })

  it('o auth-state fica CIFRADO em repouso (não expõe as chaves em claro)', () => {
    const enc = serializeAuthState(initAuthCreds(), {}, 'sess-1')
    expect(enc).not.toContain('noiseKey')
    expect(enc).not.toContain('registrationId')
  })
})
