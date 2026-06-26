import { describe, expect, it } from 'vitest'
import { avatarColor, cx, initials, statusMeta } from './ui'

describe('cx', () => {
  it('junta classes e ignora valores falsy', () => {
    expect(cx('a', false, 'b', null, undefined, 'c')).toBe('a b c')
  })
})

describe('initials', () => {
  it('usa a primeira e a última inicial', () => {
    expect(initials('Maria Helena Souza')).toBe('MS')
  })

  it('usa duas letras de um nome único', () => {
    expect(initials('Hermes')).toBe('HE')
  })

  it('ignora espaços extras', () => {
    expect(initials('  João   Castro ')).toBe('JC')
  })

  it('retorna ? para um nome vazio', () => {
    expect(initials('   ')).toBe('?')
  })
})

describe('avatarColor', () => {
  it('é determinístico para o mesmo seed', () => {
    expect(avatarColor('Maria')).toBe(avatarColor('Maria'))
  })

  it('retorna uma das classes conhecidas', () => {
    expect(['bg-brand', 'bg-brand-deep', 'bg-ai', 'bg-waiting']).toContain(avatarColor('xyz'))
  })
})

describe('statusMeta', () => {
  it('mapeia urgente para o ponto vermelho', () => {
    expect(statusMeta('urgent')).toEqual({ label: 'precisa de humano', dot: 'bg-urgent' })
  })

  it('usa a cor da marca para resolvido', () => {
    expect(statusMeta('resolved').dot).toBe('bg-brand')
  })
})
