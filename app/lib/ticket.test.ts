import { describe, expect, it } from 'vitest'
import { hasDuplicateOpenTicket, subjectsAreSimilar } from './ticket'

describe('subjectsAreSimilar', () => {
  it('treats identical subjects as the same problem', () => {
    expect(
      subjectsAreSimilar(
        'Geladeira parada — urgente (insulina)',
        'Geladeira parada — urgente (insulina)',
      ),
    ).toBe(true)
  })

  it('ignores accents and case', () => {
    expect(subjectsAreSimilar('Geladeira não gela', 'GELADEIRA NAO GELA')).toBe(true)
  })

  it('matches the same problem described with overlapping words', () => {
    expect(subjectsAreSimilar('Geladeira parada insulina', 'Geladeira parada com urgência')).toBe(
      true,
    )
  })

  it('keeps distinct problems separate', () => {
    expect(subjectsAreSimilar('Geladeira parada', 'Máquina de lavar vazando')).toBe(false)
  })

  it('does not collapse two appliances just because both are urgent', () => {
    // "urgente" é stopword — não deve, sozinha, igualar assuntos diferentes.
    expect(subjectsAreSimilar('Fogão urgente', 'Chuveiro urgente')).toBe(false)
  })
})

describe('hasDuplicateOpenTicket', () => {
  const open = ['Geladeira parada — urgente (insulina)', 'Troca de resistência do chuveiro']

  it('flags a near-identical new subject as duplicate', () => {
    expect(hasDuplicateOpenTicket('Geladeira parada (insulina)', open)).toBe(true)
  })

  it('allows a genuinely new problem through', () => {
    expect(hasDuplicateOpenTicket('Máquina de lavar não centrifuga', open)).toBe(false)
  })

  it('is false when there are no open tickets', () => {
    expect(hasDuplicateOpenTicket('Qualquer assunto', [])).toBe(false)
  })
})
