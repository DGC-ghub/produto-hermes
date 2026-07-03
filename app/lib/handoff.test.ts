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
})
