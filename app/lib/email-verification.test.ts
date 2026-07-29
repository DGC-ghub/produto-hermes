import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { confirmEmailVerification, startEmailVerification } from './email-verification.server'

const EMAIL = 'zzz-m26@verify.local'

afterEach(async () => {
  await db.account.deleteMany({ where: { email: EMAIL } })
})

function makeAccount() {
  return db.account.create({ data: { email: EMAIL, passwordHash: 's:h' } })
}

describe('verificação de e-mail (M2.6)', () => {
  it('start grava token + expiração e deixa emailVerifiedAt nulo', async () => {
    const acc = await makeAccount()
    const { token } = await startEmailVerification(
      { id: acc.id, email: acc.email },
      'https://x.test/',
    )
    const updated = await db.account.findUnique({ where: { id: acc.id } })
    expect(updated?.emailVerifyToken).toBe(token)
    expect(updated?.emailVerifyExpiresAt).not.toBeNull()
    expect(updated?.emailVerifiedAt).toBeNull()
  })

  it('confirm com token válido marca verificado e limpa o token', async () => {
    const acc = await makeAccount()
    const { token } = await startEmailVerification(
      { id: acc.id, email: acc.email },
      'https://x.test',
    )
    expect(await confirmEmailVerification(token)).toBe(acc.id)
    const updated = await db.account.findUnique({ where: { id: acc.id } })
    expect(updated?.emailVerifiedAt).not.toBeNull()
    expect(updated?.emailVerifyToken).toBeNull()
  })

  it('confirm com token inexistente → null', async () => {
    expect(await confirmEmailVerification('naoexiste')).toBeNull()
  })

  it('confirm com token já usado → null (não revalida)', async () => {
    const acc = await makeAccount()
    const { token } = await startEmailVerification(
      { id: acc.id, email: acc.email },
      'https://x.test',
    )
    await confirmEmailVerification(token)
    expect(await confirmEmailVerification(token)).toBeNull()
  })

  it('confirm com token expirado → null', async () => {
    const acc = await makeAccount()
    const { token } = await startEmailVerification(
      { id: acc.id, email: acc.email },
      'https://x.test',
    )
    await db.account.update({
      where: { id: acc.id },
      data: { emailVerifyExpiresAt: new Date(Date.now() - 1000) },
    })
    expect(await confirmEmailVerification(token)).toBeNull()
  })
})
