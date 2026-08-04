import { describe, expect, it } from 'vitest'
import {
  assertSetupTransition,
  canSetupTransition,
  InvalidSetupTransitionError,
  isSetupState,
  isTerminalState,
  publishTargetState,
  SETUP_STATES,
  type SetupActor,
  type SetupState,
} from './state'

// A máquina de estados do setup é a fonte da verdade sobre o que pode acontecer com uma
// versão de configuração. Ela é PURA: quem persiste faz compare-and-swap no estado esperado
// (spec §9), mas é aqui que se decide o que sequer é permitido tentar.
//
// Referência: docs/spec-onboarding-ia-assistido-fatia-1.md §3.1, §3.2, §3.4, §3.6.

const ativado = { activated: true }
const naoAtivado = { activated: false }

describe('SETUP_STATES', () => {
  it('tem exatamente os sete estados da spec', () => {
    expect([...SETUP_STATES]).toEqual([
      'draft',
      'submitted',
      'needs_changes',
      'ready_to_test',
      'customer_approved',
      'active',
      'superseded',
    ])
  })

  it('reconhece estado válido e rejeita lixo', () => {
    expect(isSetupState('draft')).toBe(true)
    expect(isSetupState('superseded')).toBe(true)
    expect(isSetupState('publicado')).toBe(false)
    expect(isSetupState('')).toBe(false)
    expect(isSetupState(undefined)).toBe(false)
  })
})

describe('transições permitidas (spec §3.2)', () => {
  const permitidas: Array<[SetupState | null, SetupState, SetupActor, { activated: boolean }]> = [
    // Criação
    [null, 'draft', 'system', naoAtivado], // provisionTenant
    [null, 'active', 'internal', ativado], // rollback em tenant ativo
    [null, 'customer_approved', 'internal', naoAtivado], // rollback antes da ativação
    [null, 'active', 'system', ativado], // EDIÇÃO SEGURA — nasce e publica

    // Ciclo do questionário
    ['draft', 'submitted', 'owner', naoAtivado],
    ['submitted', 'needs_changes', 'job', naoAtivado], // lacunas de negócio
    ['submitted', 'needs_changes', 'internal', naoAtivado], // correção pedida
    ['submitted', 'needs_changes', 'system', naoAtivado], // base_changed (§4.8)
    ['submitted', 'ready_to_test', 'internal', naoAtivado],
    ['needs_changes', 'draft', 'owner', naoAtivado],
    ['ready_to_test', 'needs_changes', 'owner', naoAtivado], // "pedir alteração"
    ['ready_to_test', 'needs_changes', 'system', naoAtivado], // base_changed (§4.8)

    // Publicação e ativação
    ['ready_to_test', 'customer_approved', 'owner', naoAtivado],
    ['ready_to_test', 'active', 'owner', ativado],
    ['customer_approved', 'active', 'owner', naoAtivado],
    ['active', 'superseded', 'system', ativado],
    ['customer_approved', 'superseded', 'system', naoAtivado],
  ]

  it.each(permitidas)('%s → %s por %s é permitida', (from, to, actor, ctx) => {
    expect(canSetupTransition(from, to, actor, ctx)).toBe(true)
    expect(() => assertSetupTransition(from, to, actor, ctx)).not.toThrow()
  })

  it('cobre todas as linhas da tabela da spec', () => {
    expect(permitidas).toHaveLength(17)
  })
})

describe('transições proibidas lançam', () => {
  const proibidas: Array<[string, SetupState | null, SetupState, SetupActor]> = [
    ['pular a revisão interna', 'draft', 'ready_to_test', 'owner'],
    ['publicar direto do rascunho', 'draft', 'active', 'owner'],
    ['voltar de active para draft', 'active', 'draft', 'owner'],
    ['reabrir sem passar por needs_changes', 'ready_to_test', 'draft', 'owner'],
    ['superseder um rascunho', 'draft', 'superseded', 'system'],
    ['superseder algo submetido', 'submitted', 'superseded', 'system'],
    ['superseder algo em needs_changes', 'needs_changes', 'superseded', 'system'],
    ['criar já em submitted', null, 'submitted', 'system'],
    ['criar já em ready_to_test', null, 'ready_to_test', 'internal'],
    ['transição para o mesmo estado', 'draft', 'draft', 'owner'],
  ]

  it.each(proibidas)('%s é proibida', (_label, from, to, actor) => {
    expect(canSetupTransition(from, to, actor, ativado)).toBe(false)
    expect(() => assertSetupTransition(from, to, actor, ativado)).toThrow(
      InvalidSetupTransitionError,
    )
  })

  it('a mensagem do erro diz de onde para onde e por quem', () => {
    try {
      assertSetupTransition('draft', 'active', 'owner', ativado)
      expect.unreachable('deveria ter lançado')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('draft')
      expect(message).toContain('active')
      expect(message).toContain('owner')
    }
  })
})

describe('superseded é terminal (spec §3.6, INV-21)', () => {
  it('nenhuma transição sai de superseded — nem o rollback', () => {
    const atores: SetupActor[] = ['owner', 'internal', 'system', 'job']
    for (const to of SETUP_STATES) {
      for (const actor of atores) {
        expect(canSetupTransition('superseded', to, actor, ativado)).toBe(false)
      }
    }
  })

  it('isTerminalState marca só superseded', () => {
    expect(isTerminalState('superseded')).toBe(true)
    for (const state of SETUP_STATES.filter((s) => s !== 'superseded')) {
      expect(isTerminalState(state)).toBe(false)
    }
  })
})

describe('o ator importa', () => {
  it('só o interno aprova a revisão — nem o dono nem o job', () => {
    expect(canSetupTransition('submitted', 'ready_to_test', 'internal', naoAtivado)).toBe(true)
    expect(canSetupTransition('submitted', 'ready_to_test', 'owner', naoAtivado)).toBe(false)
    expect(canSetupTransition('submitted', 'ready_to_test', 'job', naoAtivado)).toBe(false)
    expect(canSetupTransition('submitted', 'ready_to_test', 'system', naoAtivado)).toBe(false)
  })

  it('só o dono submete e aprova', () => {
    expect(canSetupTransition('draft', 'submitted', 'owner', naoAtivado)).toBe(true)
    expect(canSetupTransition('draft', 'submitted', 'system', naoAtivado)).toBe(false)
    expect(canSetupTransition('ready_to_test', 'customer_approved', 'internal', naoAtivado)).toBe(
      false,
    )
  })

  it('a edição segura é do sistema, nunca do dono (spec §3.2)', () => {
    // O cliente não cria essa versão como questionário: ela nasce e publica no servidor.
    expect(canSetupTransition(null, 'active', 'system', ativado)).toBe(true)
    expect(canSetupTransition(null, 'active', 'owner', ativado)).toBe(false)
  })
})

describe('primeira ativação × revisão de tenant já ativo (spec §3.4)', () => {
  it('tenant NUNCA ativado aprova para customer_approved, não para active', () => {
    expect(canSetupTransition('ready_to_test', 'customer_approved', 'owner', naoAtivado)).toBe(true)
    expect(canSetupTransition('ready_to_test', 'active', 'owner', naoAtivado)).toBe(false)
  })

  it('tenant JÁ ativado publica direto em active — sem reaprovar a ativação', () => {
    expect(canSetupTransition('ready_to_test', 'active', 'owner', ativado)).toBe(true)
    expect(canSetupTransition('ready_to_test', 'customer_approved', 'owner', ativado)).toBe(false)
  })

  it('a edição segura só existe em tenant já ativo', () => {
    expect(canSetupTransition(null, 'active', 'system', ativado)).toBe(true)
    expect(canSetupTransition(null, 'active', 'system', naoAtivado)).toBe(false)
  })

  it('publishTargetState traduz a mesma regra', () => {
    expect(publishTargetState(false)).toBe('customer_approved')
    expect(publishTargetState(true)).toBe('active')
  })
})
