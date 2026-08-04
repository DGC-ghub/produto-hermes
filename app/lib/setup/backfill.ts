// Backfill dos tenants que já existiam quando o onboarding obrigatório entrar (spec §8).
// PURO: recebe o que se observou de cada tenant e devolve o destino. Quem lê o banco e
// quem escreve moram no comando (scripts/setup-backfill.ts).
//
// A decisão sai de FATOS, não de uma lista de slugs: um cliente que apareça entre escrever
// isto e rodar o rollout precisa cair na regra certa sozinho. Errar tem custo assimétrico
// nos dois sentidos — marcar `draft` um tenant com WhatsApp no ar silencia um número real
// assim que o gate ligar; marcar `active` um tenant vazio deixa a IA atendendo sem base,
// que é exatamente o que esta fatia existe para impedir.

export type TenantSnapshot = {
  slug: string
  /** É uma demonstração NOSSA (`DEMO_TENANT_SLUGS`)? */
  isDemo: boolean
  knowledgeDocCount: number
  /** `ChannelSession` com status `conectado` (QR/Baileys). */
  connectedChannelCount: number
  /** `WhatsappNumber` com token próprio cifrado (canal oficial da Meta). */
  ownTokenNumberCount: number
}

export type BackfillPlan = {
  slug: string
  state: 'draft' | 'active'
  /** Exceção TEMPORÁRIA e auditada — nunca aplicada às nossas demos (§8.2). */
  grandfathered: boolean
  /** `active` sempre recebe `activatedAt`, senão a 1ª revisão viraria 1ª ativação (§3.4). */
  activated: boolean
  /** Atendendo sem base: precisa de revisão assistida antes de perder o grandfathered. */
  needsAssistedReview: boolean
  /** Por que este destino — vai impresso no dry-run, para a auditoria não ser adivinhação. */
  reason: string
}

function hasChannel(snapshot: TenantSnapshot): boolean {
  return snapshot.connectedChannelCount > 0 || snapshot.ownTokenNumberCount > 0
}

/**
 * Destino de um tenant existente. As regras são avaliadas em ordem; a primeira que casa
 * vence, e a razão registrada é a dela.
 */
export function planTenantBackfill(snapshot: TenantSnapshot): BackfillPlan {
  const base = { slug: snapshot.slug, needsAssistedReview: false }

  // 1. Demonstração nossa: move a landing, que é a porta de entrada do funil inteiro.
  //    NÃO recebe `grandfathered` — o flag bloqueia edição fora do onboarding e cobra
  //    revisão assistida, e aplicá-lo à nossa própria demo criaria uma pendência que
  //    ninguém jamais resolveria.
  if (snapshot.isDemo) {
    return {
      ...base,
      state: 'active',
      grandfathered: false,
      activated: true,
      reason: 'demonstração pública nossa — precisa continuar respondendo',
    }
  }

  // 2. Canal real conectado: derrubar seria tirar do ar o WhatsApp de um cliente. Se
  //    não houver base, a exceção fica marcada para revisão assistida em vez de virar
  //    permanente e silenciosa.
  if (hasChannel(snapshot)) {
    const semBase = snapshot.knowledgeDocCount === 0
    return {
      ...base,
      state: 'active',
      grandfathered: true,
      activated: true,
      needsAssistedReview: semBase,
      reason: semBase
        ? 'canal de WhatsApp conectado e SEM base — mantido no ar, mas exige revisão assistida'
        : 'canal de WhatsApp conectado',
    }
  }

  // 3. Base de conhecimento real: piloto em uso, ainda que sem canal ligado agora.
  if (snapshot.knowledgeDocCount > 0) {
    return {
      ...base,
      state: 'active',
      grandfathered: true,
      activated: true,
      reason: `base de conhecimento com ${snapshot.knowledgeDocCount} documento(s)`,
    }
  }

  // 4. Nada a preservar: entra no onboarding como um cadastro novo.
  return {
    ...base,
    state: 'draft',
    grandfathered: false,
    activated: false,
    reason: 'sem base de conhecimento e sem canal — nada a preservar',
  }
}

export type BackfillSummary = {
  total: number
  active: number
  draft: number
  grandfathered: number
  needsAssistedReview: number
}

/** Contagens do plano, para o cabeçalho do dry-run. Pura. */
export function summarizeBackfill(plans: readonly BackfillPlan[]): BackfillSummary {
  return {
    total: plans.length,
    active: plans.filter((p) => p.state === 'active').length,
    draft: plans.filter((p) => p.state === 'draft').length,
    grandfathered: plans.filter((p) => p.grandfathered).length,
    needsAssistedReview: plans.filter((p) => p.needsAssistedReview).length,
  }
}
