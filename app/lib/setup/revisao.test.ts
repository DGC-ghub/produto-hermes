import { describe, expect, it } from 'vitest'
import { formatarAtor, normalizarReviewer, REVIEWER_MIN_CHARS } from './revisao'

// As regras do claim de revisão, sem banco. O que depende do compare-and-swap está em
// revisao.server.test.ts.

describe('reviewer é obrigatório e identificável (§11.2)', () => {
  it('nome normal passa', () => {
    expect(normalizarReviewer('Gabriel')).toEqual({ ok: true, nome: 'Gabriel' })
  })

  it('espaços das pontas somem e os do meio colapsam', () => {
    expect(normalizarReviewer('  Ana   Maria  ')).toEqual({ ok: true, nome: 'Ana Maria' })
  })

  it.each([[undefined], [''], ['   '], ['\t\n']])('%j é ausente', (bruto) => {
    expect(normalizarReviewer(bruto)).toEqual({ ok: false, motivo: 'ausente' })
  })

  it.each([['ab'], ['x'], [' a ']])('%j é curto demais', (bruto) => {
    // "quem assumiu esta revisão" é a pergunta que alguém faz meses depois. Iniciais não
    // respondem nada.
    expect(normalizarReviewer(bruto)).toEqual({ ok: false, motivo: 'curto_demais' })
  })

  it(`o limite é ${REVIEWER_MIN_CHARS}`, () => {
    expect(normalizarReviewer('abc').ok).toBe(true)
  })
})

describe('o ator do evento leva a máquina junto', () => {
  it('formato internal:<reviewer>@<hostname>', () => {
    // "joao" em duas máquinas são duas pessoas na prática, e a auditoria precisa
    // distinguir de onde a decisão saiu.
    expect(formatarAtor('Gabriel', 'pi-hermes')).toBe('internal:Gabriel@pi-hermes')
  })
})
