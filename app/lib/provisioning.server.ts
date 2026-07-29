import { db } from '../db.server'
import {
  safeDefaultConfig,
  serializeTenantConfig,
  type TenantConfig,
} from './attendant/tenant-config'

// Provisionamento self-service (marco M2.3): cria um tenant COMPLETO numa transação —
// Tenant + config default SEGURO (safeDefaultConfig) + Account owner + Membership(owner).
// É o que o signup (M2.6) chama quando o cadastro/pagamento confirma. Idempotente: rodar de
// novo não duplica. Não faz hash de senha (recebe o hash pronto — o crypto fica no chamador).

const SAFE_SLUG = /^[a-z0-9-]+$/

export type ProvisionInput = {
  slug: string
  name: string
  ownerEmail: string
  ownerPasswordHash: string
}

export async function provisionTenant(
  input: ProvisionInput,
): Promise<{ tenantId: string; accountId: string }> {
  const slug = input.slug.trim().toLowerCase()
  if (!SAFE_SLUG.test(slug)) {
    throw new Error(`slug inválido: ${slug}`)
  }
  const email = input.ownerEmail.trim().toLowerCase()
  if (!email.includes('@')) {
    throw new Error(`e-mail inválido: ${email}`)
  }
  const name = input.name.trim() || slug

  // O config default nasce do slug (safeDefaultConfig), mas quem fala com o cliente final é o
  // NOME da empresa: sem isto a IA se apresentava como "adv-gac" (slug, com hífens) na 1ª frase.
  const initialConfig: TenantConfig = (() => {
    const base = safeDefaultConfig(slug)
    return { ...base, businessProfile: { ...base.businessProfile, name } }
  })()

  const runTx = () =>
    db.$transaction(
      async (tx) => {
        const tenant = await tx.tenant.upsert({
          where: { slug },
          create: { slug, name },
          update: {}, // idempotente: não sobrescreve um tenant já existente
        })

        const hasConfig = await tx.tenantConfigRecord.findUnique({ where: { tenantId: tenant.id } })
        if (!hasConfig) {
          await tx.tenantConfigRecord.create({
            data: { tenantId: tenant.id, json: serializeTenantConfig(initialConfig) },
          })
        }

        const account = await tx.account.upsert({
          where: { email },
          create: { email, passwordHash: input.ownerPasswordHash },
          update: {}, // não sobrescreve a senha de uma conta já existente
        })

        const hasMembership = await tx.membership.findUnique({
          where: { accountId_tenantId: { accountId: account.id, tenantId: tenant.id } },
        })
        if (!hasMembership) {
          await tx.membership.create({
            data: { accountId: account.id, tenantId: tenant.id, role: 'owner' },
          })
        }

        return { tenantId: tenant.id, accountId: account.id }
      },
      // Folga no timeout: sob escrita concorrente o default de 5s estoura "Operation has timed out".
      { maxWait: 20_000, timeout: 20_000 },
    )

  // Como o corpo é idempotente, re-tenta em erro transitório (timeout/lock) antes de desistir —
  // robustez pra escrita concorrente (webhook + signup em produção; workers de teste no mesmo db).
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await runTx()
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}
