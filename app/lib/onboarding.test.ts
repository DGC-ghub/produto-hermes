import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { safeDefaultConfig } from './attendant/tenant-config'
import { saveTenantConfigToDb } from './attendant/tenant-config-db.server'
import { writeKnowledgeDoc } from './knowledge-db.server'
import { getOnboardingStatus } from './onboarding.server'
import { ensureTenant } from './tenants.server'
import { registerWhatsappNumber } from './whatsapp.server'
import { setWhatsappCredential } from './whatsapp-credential.server'

const T = 'zzz-test-onboarding'

async function wipe() {
  const tenant = await db.tenant.findUnique({ where: { slug: T } })
  if (tenant) {
    await db.knowledgeDoc.deleteMany({ where: { tenantId: tenant.id } })
    await db.whatsappNumber.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenantConfigRecord.deleteMany({ where: { tenantId: tenant.id } })
  }
}

beforeAll(async () => {
  await ensureTenant({ slug: T, name: 'Onb' })
})
afterEach(wipe)
afterAll(async () => {
  await wipe()
  await db.tenant.deleteMany({ where: { slug: T } })
})

describe('getOnboardingStatus (Tier 1)', () => {
  it('tenant novo sem nada: 3 passos, todos pendentes, allDone=false', async () => {
    const status = await getOnboardingStatus(T)
    expect(status.total).toBe(3)
    expect(status.allDone).toBe(false)
    expect(status.doneCount).toBe(0)
    expect(status.steps.find((s) => s.key === 'knowledge')?.done).toBe(false)
    expect(status.steps.find((s) => s.key === 'whatsapp')?.done).toBe(false)
  })

  it('com um doc de conhecimento: passo knowledge fica done', async () => {
    await writeKnowledgeDoc(T, { title: 'X', content: 'y' })
    const status = await getOnboardingStatus(T)
    expect(status.steps.find((s) => s.key === 'knowledge')?.done).toBe(true)
    expect(status.doneCount).toBe(1)
  })

  it('WhatsApp só conta com token PRÓPRIO (número sem token não basta)', async () => {
    await registerWhatsappNumber('ONB_WA_1', T)
    expect((await getOnboardingStatus(T)).steps.find((s) => s.key === 'whatsapp')?.done).toBe(false)
    await setWhatsappCredential('ONB_WA_1', { accessToken: 'tok' })
    expect((await getOnboardingStatus(T)).steps.find((s) => s.key === 'whatsapp')?.done).toBe(true)
  })

  it('perfil vira done quando o segmento sai do default; tudo pronto → allDone', async () => {
    const base = safeDefaultConfig(T)
    await saveTenantConfigToDb({
      ...base,
      businessProfile: { ...base.businessProfile, name: 'Empresa X', segment: 'Contabilidade' },
    })
    await writeKnowledgeDoc(T, { title: 'X', content: 'y' })
    await registerWhatsappNumber('ONB_WA_2', T)
    await setWhatsappCredential('ONB_WA_2', { accessToken: 'tok' })
    const status = await getOnboardingStatus(T)
    expect(status.steps.find((s) => s.key === 'profile')?.done).toBe(true)
    expect(status.allDone).toBe(true)
    expect(status.doneCount).toBe(3)
  })
})
