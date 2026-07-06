import { db } from '../db.server'

// Migração de dados do marco M1.2: cada Operator existente vira uma Account (identidade
// de login) + Membership(role=owner) no seu tenant. O passwordHash é REAPROVEITADO — a
// senha atual do operador continua valendo. O login segue aceitando o username antigo via
// Account.legacyUsername (ver M1.3), e o e-mail nasce placeholder `<username>@migrado.local`
// (o dono troca depois). Idempotente: reexecutar não duplica (usa legacyUsername de âncora).

export type AccountMigrationResult = { criados: number; pulados: number; contas: string[] }

/** Dados puros de uma Account (com o vínculo owner) a partir de um Operator. Testável sem banco. */
export function accountDataFromOperator(op: {
  username: string
  passwordHash: string
  tenantId: string
}) {
  return {
    email: `${op.username}@migrado.local`,
    passwordHash: op.passwordHash,
    legacyUsername: op.username,
    memberships: { create: { tenantId: op.tenantId, role: 'owner' } },
  }
}

/** Migra todos os operadores ainda não migrados. Server-side (usa `db`). Idempotente. */
export async function migrateOperatorsToAccounts(): Promise<AccountMigrationResult> {
  const operators = await db.operator.findMany()
  const contas: string[] = []
  let criados = 0
  let pulados = 0
  for (const op of operators) {
    const existing = await db.account.findUnique({ where: { legacyUsername: op.username } })
    if (existing) {
      pulados++
      continue
    }
    await db.account.create({ data: accountDataFromOperator(op) })
    criados++
    contas.push(op.username)
  }
  return { criados, pulados, contas }
}
