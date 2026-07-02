import { describe, expect, it } from 'vitest'
import { decideHandoff } from './handoff'

function decide(message: string, retrievedCount = 2) {
  return decideHandoff({ message, retrievedCount })
}

describe('decideHandoff', () => {
  it('requests human when the user asks for a person', () => {
    expect(decide('quero falar com um atendente')).toEqual({
      needsHuman: true,
      reason: 'requested_human',
    })
  })

  it('requests human when there is no knowledge match', () => {
    expect(decide('banana espacial', 0)).toEqual({
      needsHuman: true,
      reason: 'no_knowledge_match',
    })
  })

  it('requests human for sensitive topics', () => {
    expect(decide('quero falar sobre contrato e LGPD')).toEqual({
      needsHuman: true,
      reason: 'sensitive_topic',
    })
  })

  it('does not request human for a normal message with matches', () => {
    expect(decide('quanto custa o diagnóstico?')).toEqual({ needsHuman: false })
  })

  it('handles accents in sensitive topics (jurídico/juridico)', () => {
    expect(decide('tenho um problema jurídico').reason).toBe('sensitive_topic')
    expect(decide('tenho um problema juridico').reason).toBe('sensitive_topic')
  })

  it('matches "falar com alguém" with and without accent', () => {
    expect(decide('quero falar com alguém').reason).toBe('requested_human')
    expect(decide('quero falar com alguem').reason).toBe('requested_human')
  })

  it('prioritizes requested_human over no_knowledge_match', () => {
    expect(decide('quero um atendente', 0)).toEqual({
      needsHuman: true,
      reason: 'requested_human',
    })
  })

  it('prioritizes sensitive_topic over no_knowledge_match', () => {
    expect(decide('preciso assinar o contrato', 0)).toEqual({
      needsHuman: true,
      reason: 'sensitive_topic',
    })
  })

  it('treats a negative retrievedCount as no knowledge match', () => {
    expect(decide('oi tudo bem', -1)).toEqual({
      needsHuman: true,
      reason: 'no_knowledge_match',
    })
  })

  it('does not request human for an empty message when there are matches', () => {
    expect(decide('', 3)).toEqual({ needsHuman: false })
  })

  it('requests human for an empty message when there is no match', () => {
    expect(decide('', 0)).toEqual({
      needsHuman: true,
      reason: 'no_knowledge_match',
    })
  })

  it('classifies "dados pessoais" as sensitive, not as a human request', () => {
    expect(decide('vazaram meus dados pessoais')).toEqual({
      needsHuman: true,
      reason: 'sensitive_topic',
    })
  })

  // Plural: a vertical saúde fala "dores", "sintomas", "exames" — o singular do
  // config TEM que casar, senão o guard determinístico vira promessa falsa.
  it('matches plural forms of tenant triggers (dor→dores, sintoma→sintomas)', () => {
    const triggers = ['dor', 'sintoma', 'exame']
    expect(
      decideHandoff({
        message: 'meu pai está com dores fortes no peito',
        retrievedCount: 2,
        extraSensitiveTriggers: triggers,
      }).reason,
    ).toBe('sensitive_topic')
    expect(
      decideHandoff({
        message: 'quais sintomas devo observar?',
        retrievedCount: 2,
        extraSensitiveTriggers: triggers,
      }).reason,
    ).toBe('sensitive_topic')
    expect(
      decideHandoff({
        message: 'preciso levar os exames?',
        retrievedCount: 2,
        extraSensitiveTriggers: triggers,
      }).reason,
    ).toBe('sensitive_topic')
  })

  it('matches plural inside a multi-word trigger (dor no peito→dores no peito)', () => {
    expect(
      decideHandoff({
        message: 'estou com dores no peito',
        retrievedCount: 2,
        extraSensitiveTriggers: ['dor no peito'],
      }).reason,
    ).toBe('sensitive_topic')
  })

  it('does not throw (nor match everything) when a trigger has regex metachars', () => {
    const decision = decideHandoff({
      message: 'mensagem qualquer sem gatilho',
      retrievedCount: 2,
      extraSensitiveTriggers: ['pressao (alta)', 'c++', 'valor?'],
    })
    expect(decision).toEqual({ needsHuman: false })
    // E o trigger com metachar continua ALCANÇÁVEL, casando literalmente.
    expect(
      decideHandoff({
        message: 'minha pressao (alta) voltou',
        retrievedCount: 2,
        extraSensitiveTriggers: ['pressao (alta)'],
      }).reason,
    ).toBe('sensitive_topic')
  })

  it('ignores empty/whitespace triggers instead of matching everything', () => {
    expect(
      decideHandoff({
        message: 'mensagem qualquer',
        retrievedCount: 2,
        extraSensitiveTriggers: ['', '   '],
      }),
    ).toEqual({ needsHuman: false })
  })
})
