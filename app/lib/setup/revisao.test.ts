import { describe, expect, it } from 'vitest'
import {
  artefatosPendentes,
  CAMPOS_DE_ARTEFATO,
  formatarAtor,
  normalizarReviewer,
  REVIEWER_MIN_CHARS,
} from './revisao'

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

/** Um conjunto de artefatos completo e válido. */
function artefatosBons() {
  return {
    candidateConfigJson: '{"slug":"acme"}',
    candidateKnowledgeJson: '[{"titulo":"FAQ"}]',
    summaryJson: '{"resumo":"ok"}',
    gapsJson: '[]',
    risksJson: '[]',
    validationJson: '[{"id":"q1"}]',
  }
}

describe('artefatos "presentes e válidos" (§11.1)', () => {
  it('conjunto completo não tem pendência', () => {
    expect(artefatosPendentes(artefatosBons())).toEqual([])
  })

  it.each(CAMPOS_DE_ARTEFATO.map((c) => [c]))('%s ausente é apontado', (campo) => {
    expect(artefatosPendentes({ ...artefatosBons(), [campo]: null })).toContain(campo)
  })

  it.each(CAMPOS_DE_ARTEFATO.map((c) => [c]))('%s com JSON quebrado é apontado', (campo) => {
    // Não-nulo não basta: assumir uma revisão com JSON quebrado faria o relógio de 30
    // minutos medir espera, não trabalho.
    expect(artefatosPendentes({ ...artefatosBons(), [campo]: '{quebrado' })).toContain(campo)
  })

  it('gaps e risks VAZIOS são resultado legítimo', () => {
    // Significam "não encontrei nenhum". Exigir conteúdo obrigaria o gerador a inventar
    // problema para a revisão começar.
    expect(artefatosPendentes({ ...artefatosBons(), gapsJson: '[]', risksJson: '[]' })).toEqual([])
  })

  it('validação VAZIA não serve — é ausência de prova', () => {
    expect(artefatosPendentes({ ...artefatosBons(), validationJson: '[]' })).toContain(
      'validationJson',
    )
  })

  it('base de conhecimento vazia não serve', () => {
    expect(artefatosPendentes({ ...artefatosBons(), candidateKnowledgeJson: '[]' })).toContain(
      'candidateKnowledgeJson',
    )
  })

  it('config vazia não serve', () => {
    expect(artefatosPendentes({ ...artefatosBons(), candidateConfigJson: '{}' })).toContain(
      'candidateConfigJson',
    )
  })

  it('lista onde se espera objeto (e vice-versa) não serve', () => {
    expect(artefatosPendentes({ ...artefatosBons(), candidateConfigJson: '[]' })).toContain(
      'candidateConfigJson',
    )
    expect(artefatosPendentes({ ...artefatosBons(), validationJson: '{"a":1}' })).toContain(
      'validationJson',
    )
  })

  it('objeto totalmente vazio aponta TUDO', () => {
    expect(artefatosPendentes({})).toEqual([...CAMPOS_DE_ARTEFATO])
  })
})
