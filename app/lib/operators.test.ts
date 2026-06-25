import { describe, expect, it } from 'vitest'
import {
  authenticateOperator,
  ensureSeedOperators,
  hashPassword,
  verifyPassword,
} from './operators.server'

describe('hashPassword / verifyPassword', () => {
  it('does not store the plaintext and salts each hash', async () => {
    const a = await hashPassword('segredo')
    const b = await hashPassword('segredo')
    expect(a).not.toContain('segredo')
    expect(a).not.toBe(b) // salt por senha → hashes diferentes para a mesma senha
    expect(a).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
  })

  it('verifies the correct password', async () => {
    const hash = await hashPassword('minha-senha-123')
    expect(await verifyPassword('minha-senha-123', hash)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('minha-senha-123')
    expect(await verifyPassword('errada', hash)).toBe(false)
  })

  it('rejects a malformed stored hash without throwing', async () => {
    expect(await verifyPassword('x', 'sem-dois-pontos')).toBe(false)
    expect(await verifyPassword('x', '')).toBe(false)
  })
})

describe('authenticateOperator (integração com o banco)', () => {
  it('autentica um operador semeado e carrega o tenant dele', async () => {
    await ensureSeedOperators()
    const seedPassword = process.env.OPERATOR_SEED_PASSWORD ?? 'hermes-dev'

    const ok = await authenticateOperator('dgc', seedPassword)
    expect(ok).not.toBeNull()
    expect(ok?.username).toBe('dgc')
    expect(ok?.tenantSlug).toBe('dgc')
    expect(ok?.tenantId).toBeTruthy()
  })

  it('rejeita senha errada e usuário inexistente (fail-closed)', async () => {
    await ensureSeedOperators()
    expect(await authenticateOperator('dgc', 'senha-errada')).toBeNull()
    expect(await authenticateOperator('nao-existe', 'qualquer')).toBeNull()
  })

  it('mantém o seed idempotente (não duplica operadores)', async () => {
    await ensureSeedOperators()
    await ensureSeedOperators()
    // username é @unique no schema; rodar duas vezes não deve lançar nem duplicar.
    const ok = await authenticateOperator(
      'prestacon',
      process.env.OPERATOR_SEED_PASSWORD ?? 'hermes-dev',
    )
    expect(ok?.tenantSlug).toBe('prestacon')
  })
})
