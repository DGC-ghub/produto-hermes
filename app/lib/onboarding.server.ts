import { resolveTenantConfig } from './attendant/tenant-config-db.server'
import { listKnowledgeDocs } from './knowledge-db.server'
import { listTenantWhatsappNumbers } from './whatsapp.server'

// Estado de prontidão de um tenant novo (Tier 1): os passos que tiram a IA do "vazio" e a
// fazem atender de verdade. Alimenta o checklist de onboarding no /atendente. Server-side.

export type OnboardingStep = { key: string; label: string; done: boolean; href: string }
export type OnboardingStatus = {
  steps: OnboardingStep[]
  doneCount: number
  total: number
  allDone: boolean
}

/**
 * Agrega config + knowledge + números pra dizer o que ainda falta o dono configurar. O passo
 * "perfil" conta como feito quando o segmento sai do default (`não informado`). Server-side.
 */
export async function getOnboardingStatus(tenantSlug: string): Promise<OnboardingStatus> {
  const [config, docs, numbers] = await Promise.all([
    resolveTenantConfig(tenantSlug),
    listKnowledgeDocs(tenantSlug),
    listTenantWhatsappNumbers(tenantSlug),
  ])
  const segment = config?.businessProfile.segment?.trim() ?? ''
  const steps: OnboardingStep[] = [
    {
      key: 'profile',
      label: 'Configurar o perfil da empresa',
      done: segment.length > 0 && segment !== 'não informado',
      href: '/configuracoes',
    },
    {
      key: 'knowledge',
      label: 'Adicionar a base de conhecimento',
      done: docs.length > 0,
      href: '/conhecimento',
    },
    {
      key: 'whatsapp',
      label: 'Conectar o WhatsApp',
      done: numbers.some((n) => n.hasOwnToken),
      href: '/conectar-whatsapp',
    },
  ]
  const doneCount = steps.filter((s) => s.done).length
  return { steps, doneCount, total: steps.length, allDone: doneCount === steps.length }
}
