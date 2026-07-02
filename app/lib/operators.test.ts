import { describe, expect, it } from 'vitest'
import { db } from '../db.server'
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
      'assistencia-tecnica-demo',
      process.env.OPERATOR_SEED_PASSWORD ?? 'hermes-dev',
    )
    expect(ok?.tenantSlug).toBe('assistencia-tecnica-demo')
  })

  // Bloqueio S2 do plano de entrega: tenant de cliente REAL não nasce com a senha
  // seed compartilhada — credencial dele só via `npm run operator:add`.
  it('NÃO semeia operador para tenant de cliente real (prestacon/csmed)', async () => {
    // Preserva a linha existente (o dono pode estar usando) e restaura no final.
    const existing = await db.operator.findUnique({ where: { username: 'prestacon' } })
    try {
      if (existing) {
        await db.operator.delete({ where: { username: 'prestacon' } })
      }
      await ensureSeedOperators()
      expect(await db.operator.findUnique({ where: { username: 'prestacon' } })).toBeNull()
    } finally {
      if (existing) {
        await db.operator.create({
          data: {
            id: existing.id,
            username: existing.username,
            passwordHash: existing.passwordHash,
            tenantId: existing.tenantId,
          },
        })
      }
    }
  })
})
