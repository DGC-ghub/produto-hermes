// Máquina de estados da versão de configuração da IA (spec §3.1-3.6). PURA: sem banco,
// sem I/O. Quem persiste faz compare-and-swap no estado esperado (spec §9) — mas é aqui
// que se decide o que sequer é permitido tentar.
//
// Duas regras que não são óbvias e por isso moram em código, não em prosa:
//  1. `customer_approved` só existe na PRIMEIRA configuração. Um tenant já ativo publica
//     revisão direto em `active`, senão aprovar uma correção derrubaria o WhatsApp de quem
//     está atendendo (spec §3.4).
//  2. `superseded` é terminal. O rollback CLONA a versão antiga em vez de ressuscitá-la,
//     para que a regra da versão-base continue valendo sem exceção (spec §3.6, §4.6).

export const SETUP_STATES = [
  'draft',
  'submitted',
  'needs_changes',
  'ready_to_test',
  'customer_approved',
  'active',
  'superseded',
] as const

export type SetupState = (typeof SETUP_STATES)[number]

/** Quem pede a transição. O ator é parte da regra, não decoração. */
export type SetupActor =
  | 'owner' // o dono da empresa, autenticado
  | 'internal' // nossa equipe, por comando de terminal (não há rota HTTP)
  | 'system' // o servidor, dentro de uma transação (edição segura, base_changed, supersede)
  | 'job' // o worker de geração

/** O que a regra precisa saber sobre o setup além do estado da versão. */
export type SetupTransitionContext = {
  /** O setup já foi ativado alguma vez? (`AiSetup.activatedAt != null`) */
  activated: boolean
}

export class InvalidSetupTransitionError extends Error {
  constructor(
    readonly from: SetupState | null,
    readonly to: SetupState,
    readonly actor: SetupActor,
  ) {
    super(
      `Transição de setup inválida: ${from ?? '(criação)'} → ${to} por "${actor}". ` +
        'Ver docs/spec-onboarding-ia-assistido-fatia-1.md §3.2.',
    )
    this.name = 'InvalidSetupTransitionError'
  }
}

type Rule = {
  from: SetupState | null // null = criação da versão
  to: SetupState
  actors: readonly SetupActor[]
  /** Restrição extra de contexto; ausente = vale em qualquer contexto. */
  requires?: (ctx: SetupTransitionContext) => boolean
}

// Espelho literal da tabela da spec §3.2. Qualquer par que não esteja aqui é proibido.
const RULES: readonly Rule[] = [
  // ── Criação ────────────────────────────────────────────────────────────
  // Tenant novo nasce com um rascunho vazio, dentro da transação do provisionTenant.
  { from: null, to: 'draft', actors: ['system'] },
  // Rollback: clona uma versão antiga e publica na mesma transação (§4.6). O destino
  // segue a mesma regra da primeira ativação.
  { from: null, to: 'active', actors: ['internal'], requires: (c) => c.activated },
  { from: null, to: 'customer_approved', actors: ['internal'], requires: (c) => !c.activated },
  // Edição segura: nasce e publica na mesma transação. Só existe em tenant já ativo, e
  // só o servidor a cria — o cliente nunca edita essa versão como questionário (§3.2).
  { from: null, to: 'active', actors: ['system'], requires: (c) => c.activated },

  // ── Ciclo do questionário ──────────────────────────────────────────────
  { from: 'draft', to: 'submitted', actors: ['owner'] },
  // Lacunas de negócio (job), correção pedida (interno) ou base mudou (system, §4.8).
  { from: 'submitted', to: 'needs_changes', actors: ['job', 'internal', 'system'] },
  { from: 'submitted', to: 'ready_to_test', actors: ['internal'] },
  { from: 'needs_changes', to: 'draft', actors: ['owner'] },
  // "Pedir alteração" (owner) ou base mudou (system, §4.8).
  { from: 'ready_to_test', to: 'needs_changes', actors: ['owner', 'system'] },

  // ── Publicação e ativação ──────────────────────────────────────────────
  {
    from: 'ready_to_test',
    to: 'customer_approved',
    actors: ['owner'],
    requires: (c) => !c.activated,
  },
  { from: 'ready_to_test', to: 'active', actors: ['owner'], requires: (c) => c.activated },
  { from: 'customer_approved', to: 'active', actors: ['owner'] },

  // ── Fim de linha ───────────────────────────────────────────────────────
  // Só o que chegou a ser publicado pode ser superseded: um rascunho nunca esteve no ar.
  { from: 'active', to: 'superseded', actors: ['system'] },
  { from: 'customer_approved', to: 'superseded', actors: ['system'] },
]

const DEFAULT_CONTEXT: SetupTransitionContext = { activated: false }

/** É um estado conhecido? Type guard para valor vindo do banco (coluna é String). */
export function isSetupState(value: unknown): value is SetupState {
  return typeof value === 'string' && (SETUP_STATES as readonly string[]).includes(value)
}

/** `superseded` é o único estado do qual nada sai (INV-21). */
export function isTerminalState(state: SetupState): boolean {
  return state === 'superseded'
}

/** A transição é permitida? Pura. */
export function canSetupTransition(
  from: SetupState | null,
  to: SetupState,
  actor: SetupActor,
  ctx: SetupTransitionContext = DEFAULT_CONTEXT,
): boolean {
  return RULES.some(
    (rule) =>
      rule.from === from &&
      rule.to === to &&
      rule.actors.includes(actor) &&
      (rule.requires?.(ctx) ?? true),
  )
}

/** Como `canSetupTransition`, mas lança quando a transição não existe. */
export function assertSetupTransition(
  from: SetupState | null,
  to: SetupState,
  actor: SetupActor,
  ctx: SetupTransitionContext = DEFAULT_CONTEXT,
): void {
  if (!canSetupTransition(from, to, actor, ctx)) {
    throw new InvalidSetupTransitionError(from, to, actor)
  }
}

/**
 * Estado de destino ao publicar uma versão (spec §3.4). Tenant nunca ativado precisa do
 * segundo ato explícito ("Liberar minha IA"); tenant já ativo segue atendendo sem
 * interrupção — é isto que impede uma revisão de derrubar quem está no ar.
 */
export function publishTargetState(activated: boolean): 'active' | 'customer_approved' {
  return activated ? 'active' : 'customer_approved'
}
