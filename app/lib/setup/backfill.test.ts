import { describe, expect, it } from 'vitest'
import {
  type BackfillPlan,
  planTenantBackfill,
  summarizeBackfill,
  type TenantSnapshot,
} from './backfill'

// O backfill decide o que acontece com os tenants que já existiam quando o onboarding
// obrigatório entrar. Errar aqui é caro nos DOIS sentidos: marcar `draft` um tenant com
// WhatsApp conectado tira um número real do ar assim que o gate ligar; marcar `active` um
// tenant vazio deixa a IA atendendo sem base — exatamente o que a fatia existe para impedir.
//
// A decisão sai de FATOS observados (tem base? tem canal? é demo nossa?), nunca de uma
// lista de slugs: um cliente novo que apareça antes do rollout precisa cair na regra certa
// sozinho.
//
// Referência: docs/spec-onboarding-ia-assistido-fatia-1.md §8.1, §8.2.

function snapshot(over: Partial<TenantSnapshot> = {}): TenantSnapshot {
  return {
    slug: 'acme',
    isDemo: false,
    knowledgeDocCount: 0,
    connectedChannelCount: 0,
    ownTokenNumberCount: 0,
    ...over,
  }
}

describe('tenant sem base e sem canal → draft', () => {
  it('nada a preservar: entra no onboarding como todo mundo', () => {
    const plan = planTenantBackfill(snapshot({ slug: 'qr-teste' }))
    expect(plan.state).toBe('draft')
    expect(plan.grandfathered).toBe(false)
    expect(plan.activated).toBe(false)
  })

  it('a razão diz o porquê, para a auditoria não virar adivinhação', () => {
    const plan = planTenantBackfill(snapshot())
    expect(plan.reason).toMatch(/sem base|sem conhecimento/i)
  })
})

describe('tenant com canal conectado → active + grandfathered', () => {
  it('QR conectado nunca é derrubado pelo rollout, mesmo sem base', () => {
    // É o caso do adv-gac: zero documentos, mas com WhatsApp real no ar. Marcar `draft`
    // silenciaria o número de um cliente de verdade no instante em que o gate ligasse.
    const plan = planTenantBackfill(
      snapshot({ slug: 'adv-gac', knowledgeDocCount: 0, connectedChannelCount: 1 }),
    )
    expect(plan.state).toBe('active')
    expect(plan.grandfathered).toBe(true)
    expect(plan.activated).toBe(true)
    expect(plan.reason).toMatch(/canal/i)
  })

  it('número oficial com token próprio conta como canal', () => {
    const plan = planTenantBackfill(snapshot({ ownTokenNumberCount: 1 }))
    expect(plan.state).toBe('active')
    expect(plan.grandfathered).toBe(true)
  })

  it('canal conectado vence a ausência de base — a exceção é registrada, não escondida', () => {
    const plan = planTenantBackfill(snapshot({ connectedChannelCount: 2 }))
    expect(plan.grandfathered).toBe(true)
    expect(plan.needsAssistedReview).toBe(true)
  })
})

describe('tenant com base → active + grandfathered', () => {
  it('piloto com conhecimento real continua atendendo', () => {
    const plan = planTenantBackfill(snapshot({ slug: 'csmed', knowledgeDocCount: 6 }))
    expect(plan.state).toBe('active')
    expect(plan.grandfathered).toBe(true)
    expect(plan.activated).toBe(true)
    expect(plan.reason).toMatch(/base|conhecimento/i)
  })
})

describe('demonstração nossa → active, SEM grandfathered', () => {
  it('a demo pública move a landing e não pode parar', () => {
    const plan = planTenantBackfill(snapshot({ slug: 'dgc', isDemo: true, knowledgeDocCount: 5 }))
    expect(plan.state).toBe('active')
    expect(plan.activated).toBe(true)
  })

  it('não recebe grandfathered: é nossa, não é exceção de cliente', () => {
    // `grandfathered` bloqueia edição fora do onboarding e cobra revisão assistida (§8.2).
    // Aplicar isso à nossa própria demo criaria uma pendência que nunca seria resolvida.
    const plan = planTenantBackfill(snapshot({ isDemo: true, knowledgeDocCount: 5 }))
    expect(plan.grandfathered).toBe(false)
    expect(plan.needsAssistedReview).toBe(false)
  })

  it('demo sem base ainda assim não é grandfathered', () => {
    const plan = planTenantBackfill(snapshot({ isDemo: true, knowledgeDocCount: 0 }))
    expect(plan.grandfathered).toBe(false)
  })
})

describe('todo tenant que vai para active recebe activatedAt', () => {
  // Sem isso, a primeira revisão de um tenant legado seria confundida com primeira
  // ativação (§3.4) e o cliente teria de apertar "Liberar minha IA" de novo, do nada.
  const casos: Array<[string, Partial<TenantSnapshot>]> = [
    ['demo', { isDemo: true }],
    ['com canal', { connectedChannelCount: 1 }],
    ['com base', { knowledgeDocCount: 3 }],
    ['com token oficial', { ownTokenNumberCount: 1 }],
  ]

  it.each(casos)('%s', (_label, over) => {
    const plan = planTenantBackfill(snapshot(over))
    expect(plan.state).toBe('active')
    expect(plan.activated).toBe(true)
  })

  it('quem fica em draft NÃO recebe activatedAt', () => {
    expect(planTenantBackfill(snapshot()).activated).toBe(false)
  })
})

describe('precedência das regras', () => {
  it('demo vence canal e base', () => {
    const plan = planTenantBackfill(
      snapshot({ isDemo: true, connectedChannelCount: 1, knowledgeDocCount: 9 }),
    )
    expect(plan.grandfathered).toBe(false)
  })

  it('canal e base juntos continuam grandfathered uma vez só', () => {
    const plan = planTenantBackfill(snapshot({ connectedChannelCount: 1, knowledgeDocCount: 9 }))
    expect(plan.state).toBe('active')
    expect(plan.grandfathered).toBe(true)
  })
})

describe('os sete tenants reais do banco (spec §8.1)', () => {
  // Espelha o estado observado em 2026-08-03. Se a regra mudar e algum destes sair do
  // destino previsto na spec, este teste quebra antes de alguém rodar o backfill.
  const reais: Array<[string, TenantSnapshot, Pick<BackfillPlan, 'state' | 'grandfathered'>]> = [
    [
      'dgc',
      snapshot({ slug: 'dgc', isDemo: true, knowledgeDocCount: 5 }),
      { state: 'active', grandfathered: false },
    ],
    [
      'assistencia-tecnica-demo',
      snapshot({ slug: 'assistencia-tecnica-demo', isDemo: true, knowledgeDocCount: 6 }),
      { state: 'active', grandfathered: false },
    ],
    [
      'prestacon',
      snapshot({ slug: 'prestacon', knowledgeDocCount: 6 }),
      { state: 'active', grandfathered: true },
    ],
    [
      'csmed',
      snapshot({ slug: 'csmed', knowledgeDocCount: 6 }),
      { state: 'active', grandfathered: true },
    ],
    [
      'adv-gac',
      snapshot({ slug: 'adv-gac', knowledgeDocCount: 0, connectedChannelCount: 1 }),
      { state: 'active', grandfathered: true },
    ],
    [
      'advocacia-primo',
      snapshot({ slug: 'advocacia-primo' }),
      { state: 'draft', grandfathered: false },
    ],
    ['qr-teste', snapshot({ slug: 'qr-teste' }), { state: 'draft', grandfathered: false }],
  ]

  it.each(reais)('%s cai no destino da spec', (_slug, snap, esperado) => {
    const plan = planTenantBackfill(snap)
    expect({ state: plan.state, grandfathered: plan.grandfathered }).toEqual(esperado)
  })

  it('o resumo bate com a spec: 5 ativos, 2 rascunhos, 3 grandfathered', () => {
    const planos = reais.map(([, snap]) => planTenantBackfill(snap))
    const resumo = summarizeBackfill(planos)

    expect(resumo.total).toBe(7)
    expect(resumo.active).toBe(5)
    expect(resumo.draft).toBe(2)
    expect(resumo.grandfathered).toBe(3) // prestacon, csmed, adv-gac
    expect(resumo.needsAssistedReview).toBe(1) // só adv-gac: ativo com canal e SEM base
  })
})
