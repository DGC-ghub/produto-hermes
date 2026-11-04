import { describe, expect, it } from 'vitest'
import { containsLibsignalSessionSecret } from './libsignal-log-guard.server'

describe('containsLibsignalSessionSecret', () => {
  it.each([
    ['Closing session:', { currentRatchet: { rootKey: Buffer.from('segredo') } }],
    ['Session already closed', { _chains: { private: 'segredo' } }],
    ['Opening session:', { indexInfo: { remoteIdentityKey: Buffer.from('segredo') } }],
    ['Removing old closed session:', { registrationId: 123 }],
  ])('bloqueia logs do libsignal que carregam a sessão inteira: %s', (...args) => {
    expect(containsLibsignalSessionSecret(args)).toBe(true)
  })

  it.each([
    ['Closing open session in favor of incoming prekey bundle'],
    ['[baileys] conexão fechada', 515],
    ['mensagem operacional normal', { status: 'conectado' }],
  ])('preserva logs operacionais sem material da sessão: %s', (...args) => {
    expect(containsLibsignalSessionSecret(args)).toBe(false)
  })
})
