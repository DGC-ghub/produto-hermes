import { describe, expect, it, vi } from 'vitest'
import { montarConfigFinal } from './artefatos'

// Arquivo separado de propósito: `vi.mock` vale para o módulo inteiro, e trocar a política
// no meio de `artefatos.test.ts` mudaria o resultado esperado de todos os outros testes.
//
// O que se prova aqui é DELEGAÇÃO, não comportamento: que `montarConfigFinal` pergunta a
// `politicaDeFerramentas` em vez de embutir a resposta.
//
// Por que isso precisa de teste próprio: enquanto a política devolve `[]`, escrever
// `tools: []` na mão produz exatamente o mesmo resultado — nenhum teste distingue as duas
// implementações. A diferença aparece só no dia em que o dono habilitar a primeira
// ferramenta, e nesse dia o sintoma seria "liguei a ferramenta e ela não chegou na config",
// sem nada apontando onde a ligação se perdeu. Com a política trocada por uma sentinela, a
// desconexão aparece agora.

const SENTINELA = {
  name: 'abrir_chamado' as const,
  enabled: true,
  limits: { requireConfirmation: true },
}

vi.mock('./ferramentas', () => ({
  politicaDeFerramentas: () => [SENTINELA],
}))

/** Só o suficiente para `montarConfigFinal` ter o que montar — ela não valida nada. */
function candidata(extra: Record<string, unknown> = {}) {
  return {
    objectives: ['tirar_duvidas'],
    knowledge: { sourcePolicy: 'answer_only_from_knowledge' },
    ...extra,
  }
}

describe('montarConfigFinal delega a decisão de tools à política (§6.7)', () => {
  it('a config final recebe exatamente o que a política decidiu', () => {
    const final = montarConfigFinal('acme', candidata()) as { tools: unknown }
    expect(final.tools).toEqual([SENTINELA])
  })

  it('e mesmo delegando, ignora o que a candidata pediu', () => {
    // As duas coisas juntas: a política manda, e a candidata não participa nem por mesclagem.
    const final = montarConfigFinal(
      'acme',
      candidata({
        tools: [
          { name: 'pedir_agendamento', enabled: true, limits: { requireConfirmation: false } },
        ],
      }),
    ) as { tools: { name: string }[] }

    expect(final.tools.map((t) => t.name)).toEqual(['abrir_chamado'])
  })
})
