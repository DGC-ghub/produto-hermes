import { describe, expect, it } from 'vitest'
import {
  type Baseline,
  compararComBaseline,
  parseBaseline,
  TOLERANCIAS_PADRAO,
  toBaseline,
} from './baseline'
import { type RunOutcome, scoreRun } from './scoring'

function exec(
  scenarioId: string,
  checks: Array<[string, boolean] | [string, boolean, { critico?: boolean }]>,
  fellToFallback = false,
): RunOutcome {
  return {
    scenarioId,
    checks: checks.map(([id, passou, extra]) => ({
      id,
      passou,
      peso: 1,
      critico: extra?.critico,
    })),
    latencyMs: 1000,
    fellToFallback,
  }
}

const META = { provider: 'claude_cli', modelo: 'sonnet', criadoEm: '2026-07-28T00:00:00.000Z' }

/** Baseline com um cenário e uma verificação, ambos perfeitos. */
function baselinePerfeito(checkId = 'escala', critico = false): Baseline {
  return toBaseline(scoreRun([exec('cenario-a', [[checkId, true, { critico }]])]), META)
}

describe('toBaseline', () => {
  it('serializa score global, por cenário e por verificação', () => {
    const run = scoreRun([
      exec('a', [['c1', true]]),
      exec('a', [['c1', false]]),
      exec('b', [['c2', true]]),
    ])
    const baseline = toBaseline(run, META)
    expect(baseline.versao).toBe(1)
    expect(baseline.provider).toBe('claude_cli')
    expect(baseline.cenarios.a.checks.c1).toBe(0.5)
    expect(baseline.cenarios.b.checks.c2).toBe(1)
    expect(baseline.score).toBe(0.75)
  })
})

describe('compararComBaseline — sem baseline', () => {
  it('aprova a primeira rodada e marca todos os cenários como novos', () => {
    const veredito = compararComBaseline(scoreRun([exec('a', [['c1', true]])]), null)
    expect(veredito.aprovado).toBe(true)
    expect(veredito.semBaseline).toBe(true)
    expect(veredito.novosCenarios).toEqual(['a'])
  })
})

describe('compararComBaseline — regressões', () => {
  it('aprova quando a qualidade se mantém', () => {
    const veredito = compararComBaseline(
      scoreRun([exec('cenario-a', [['escala', true]])]),
      baselinePerfeito(),
    )
    expect(veredito.aprovado).toBe(true)
    expect(veredito.regressoes).toEqual([])
  })

  it('reprova quando o score global cai além da tolerância', () => {
    // 1.0 → 0.0, muito além dos 5 pontos tolerados.
    const veredito = compararComBaseline(
      scoreRun([exec('cenario-a', [['escala', false]])]),
      baselinePerfeito(),
    )
    expect(veredito.aprovado).toBe(false)
    expect(veredito.regressoes.map((r) => r.tipo)).toContain('global')
  })

  it('tolera ruído pequeno de LLM sem reprovar', () => {
    // 10 execuções, 1 falha → 0.9. Queda de 0.1: acima do global (0.05), mas o
    // teste aqui é o comportamento por VERIFICAÇÃO (tolerância 0.2), que aguenta.
    const execucoes = Array.from({ length: 10 }, (_, i) => exec('cenario-a', [['escala', i !== 0]]))
    const veredito = compararComBaseline(scoreRun(execucoes), baselinePerfeito(), {
      ...TOLERANCIAS_PADRAO,
      global: 0.15,
      cenario: 0.15,
    })
    expect(veredito.aprovado).toBe(true)
  })

  it('verificação CRÍTICA não tem tolerância: uma falha em dez já reprova', () => {
    const execucoes = Array.from({ length: 10 }, (_, i) =>
      exec('cenario-a', [['vazou_prompt', i !== 0, { critico: true }]]),
    )
    // Tolerâncias frouxas de propósito — o crítico tem que reprovar mesmo assim.
    const veredito = compararComBaseline(
      scoreRun(execucoes),
      baselinePerfeito('vazou_prompt', true),
      {
        global: 1,
        cenario: 1,
        check: 1,
        fallback: 1,
      },
    )
    expect(veredito.aprovado).toBe(false)
    const critica = veredito.regressoes.find((r) => r.tipo === 'critico')
    expect(critica?.alvo).toBe('cenario-a/vazou_prompt')
    expect(critica?.agora).toBe(0.9)
  })

  it('não reprova por cenário ou verificação NOVOS (nada com que comparar)', () => {
    // Subir a régua não pode ser lido como "quebrou": a verificação nova falha,
    // mas ela não existia no baseline. Entra na comparação na próxima promoção.
    const run = scoreRun([
      exec('cenario-a', [
        ['escala', true],
        ['check-novo', false],
      ]),
      exec('cenario-novo', [['x', false]]),
    ])
    const veredito = compararComBaseline(run, baselinePerfeito())
    expect(veredito.regressoes).toEqual([])
    expect(veredito.aprovado).toBe(true)
    expect(veredito.novosCenarios).toEqual(['cenario-novo'])
  })

  it('compara sobre as verificações COMUNS: uma que sumiu não mascara a que piorou', () => {
    // baseline: escala=1 e tom=1. Agora 'tom' não é mais medido e 'escala' caiu a 0.
    // Se a comparação usasse o score cheio dos dois lados, o cenário mostraria
    // 1.0 → 0.0 de qualquer jeito; o que se prova aqui é que a queda é atribuída
    // à verificação certa e não some junto com a que foi removida.
    const baseline = toBaseline(
      scoreRun([
        exec('cenario-a', [
          ['escala', true],
          ['tom', true],
        ]),
      ]),
      META,
    )
    const veredito = compararComBaseline(
      scoreRun([exec('cenario-a', [['escala', false]])]),
      baseline,
    )
    expect(veredito.aprovado).toBe(false)
    const cenario = veredito.regressoes.find((r) => r.tipo === 'cenario')
    expect(cenario).toMatchObject({ alvo: 'cenario-a', antes: 1, agora: 0 })
  })

  it('reporta cenário que sumiu, sem reprovar', () => {
    const veredito = compararComBaseline(
      scoreRun([exec('outro', [['x', true]])]),
      baselinePerfeito(),
    )
    expect(veredito.cenariosSumidos).toEqual(['cenario-a'])
    expect(veredito.aprovado).toBe(true)
  })

  it('registra melhorias para o relatório', () => {
    const baseline = toBaseline(
      scoreRun([exec('cenario-a', [['escala', true]]), exec('cenario-a', [['escala', false]])]),
      META,
    )
    const veredito = compararComBaseline(
      scoreRun([exec('cenario-a', [['escala', true]])]),
      baseline,
    )
    expect(veredito.aprovado).toBe(true)
    expect(veredito.melhorias.map((m) => m.alvo)).toContain('score global')
  })
})

describe('compararComBaseline — fallback infla a nota', () => {
  it('reprova a rodada quando o motor caiu no fallback demais', () => {
    // Verificações do tipo "não pode conter X" passam de graça na resposta genérica:
    // sem esta trava, uma queda do provider viraria "100% de aprovação".
    const execucoes = [
      exec('a', [['nao_contem', true]], true),
      exec('a', [['nao_contem', true]], true),
      exec('a', [['nao_contem', true]], false),
    ]
    const veredito = compararComBaseline(scoreRun(execucoes), null)
    expect(veredito.aprovado).toBe(false)
    expect(veredito.regressoes[0].tipo).toBe('fallback')
  })

  it('aceita fallback esporádico dentro do limiar', () => {
    const execucoes = [
      exec('a', [['x', true]], true),
      ...Array.from({ length: 9 }, () => exec('a', [['x', true]], false)),
    ]
    expect(compararComBaseline(scoreRun(execucoes), null).aprovado).toBe(true)
  })
})

describe('parseBaseline', () => {
  it('lê um baseline válido', () => {
    const original = baselinePerfeito()
    expect(parseBaseline(JSON.stringify(original))).toEqual(original)
  })

  it('falha alto em JSON corrompido, versão futura ou campos faltando', () => {
    // Silenciar aqui daria "aprovado" de mentira comparando contra lixo.
    expect(() => parseBaseline('{quebrado')).toThrow()
    expect(() => parseBaseline('{"versao":99}')).toThrow('versão não suportada')
    expect(() => parseBaseline('{"versao":1}')).toThrow('campos obrigatórios')
    expect(() => parseBaseline('null')).toThrow('não é um objeto')
  })
})
