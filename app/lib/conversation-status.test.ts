import { describe, expect, it } from 'vitest'
import {
  isConversationAction,
  isHumanHandling,
  nextConversationStatus,
} from './conversation-status'

describe('nextConversationStatus', () => {
  it('assumir: open/needs_human -> human', () => {
    expect(nextConversationStatus('open', 'assumir')).toBe('human')
    expect(nextConversationStatus('needs_human', 'assumir')).toBe('human')
  })

  it('assumir: não assume uma conversa encerrada', () => {
    expect(nextConversationStatus('closed', 'assumir')).toBeNull()
  })

  it('devolver: human -> open, e só de human', () => {
    expect(nextConversationStatus('human', 'devolver')).toBe('open')
    expect(nextConversationStatus('open', 'devolver')).toBeNull()
    expect(nextConversationStatus('needs_human', 'devolver')).toBeNull()
  })

  it('encerrar: de qualquer estado ativo -> closed', () => {
    expect(nextConversationStatus('open', 'encerrar')).toBe('closed')
    expect(nextConversationStatus('needs_human', 'encerrar')).toBe('closed')
    expect(nextConversationStatus('human', 'encerrar')).toBe('closed')
  })
})

describe('isConversationAction', () => {
  it('reconhece ações válidas e rejeita o resto', () => {
    expect(isConversationAction('assumir')).toBe(true)
    expect(isConversationAction('encerrar')).toBe(true)
    expect(isConversationAction('xpto')).toBe(false)
    expect(isConversationAction('')).toBe(false)
  })
})

describe('isHumanHandling', () => {
  it('true apenas para "human"', () => {
    expect(isHumanHandling('human')).toBe(true)
    expect(isHumanHandling('open')).toBe(false)
    expect(isHumanHandling('needs_human')).toBe(false)
  })
})
