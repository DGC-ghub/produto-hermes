import { describe, expect, it } from 'vitest'
import { pct, type RunOutcome, scoreRun, scoreScenario } from './scoring'

function exec(
  scenarioId: string,
  checks: Array<[string, boolean] | [string, boolean, { peso?: number; critico?: boolean }]>,
  opts: { latencyMs?: number; fellToFallback?: boolean } = {},
): RunOutcome {
  return {
    scenarioId,
    checks: checks.map(([id, passou, extra]) => ({
      id,
      passou,
      peso: extra?.peso ?? 1,
      critico: extra?.critico,
    })),
    latencyMs: opts.latencyMs ?? 1000,
    fellToFallback: opts.fellToFallback ?? false,
  }
}

describe('scoreScenario', () => {
  it('vira taxa de aprovação ao longo das repetições, não pass/fail', () => {
    // O ponto do harness: 2 de 3 é 0.67, não "falhou".
    const score = scoreScenario([
      exec('a', [['escala', true]]),
      exec('a', [['escala', true]]),
      exec('a', [['escala', false]]),
    ])
    expect(score.execucoes).toBe(3)
    expect(score.checks[0].taxa).toBeCloseTo(0.6667, 3)
    expect(score.score).toBeCloseTo(0.6667, 3)
  })

  it('pondera pelos pesos', () => {
    const score = scoreScenario([
      exec('a', [
        ['importante', true, { peso: 3 }],
        ['secundario', false, { peso: 1 }],
      ]),
    ])
    expect(score.score).toBe(0.75) // 3/4
  })

  it('cenário sem verificação (só revisão humana) pontua 1 — não pune nem premia', () => {
    expect(scoreScenario([exec('a', [])]).score).toBe(1)
  })

  it('resume a latência das repetições', () => {
    const score = scoreScenario([
      exec('a', [['x', true]], { latencyMs: 10_000 }),
      exec('a', [['x', true]], { latencyMs: 30_000 }),
    ])
    expect(score.latency.count).toBe(2)
    expect(score.latency.maxMs).toBe(30_000)
  })

  it('mede a taxa de queda no fallback', () => {
    const score = scoreScenario([
      exec('a', [['x', true]], { fellToFallback: true }),
      exec('a', [['x', true]]),
    ])
    expect(score.fallbackRate).toBe(0.5)
  })

  it('preserva peso e criticidade do check', () => {
    const score = scoreScenario([exec('a', [['vazou_prompt', true, { peso: 5, critico: true }]])])
    expect(score.checks[0]).toMatchObject({ peso: 5, critico: true, taxa: 1 })
  })

  it('recusa lista vazia em vez de inventar um score', () => {
    expect(() => scoreScenario([])).toThrow('sem execuções')
  })
})

describe('scoreRun', () => {
  it('agrupa por cenário e dá o mesmo peso a cada um', () => {
    // 'a' tem 3 verificações e vai mal; 'b' tem 1 e vai bem. Se o score fosse por
    // verificação, 'a' dominaria. Por cenário, cada um vale metade.
    const run = scoreRun([
      exec('a', [
        ['c1', false],
        ['c2', false],
        ['c3', false],
      ]),
      exec('b', [['c1', true]]),
    ])
    expect(run.scenarios).toHaveLength(2)
    expect(run.score).toBe(0.5)
  })

  it('ordena os cenários por id (relatório e baseline estáveis no diff)', () => {
    const run = scoreRun([exec('zeta', [['x', true]]), exec('alfa', [['x', true]])])
    expect(run.scenarios.map((s) => s.scenarioId)).toEqual(['alfa', 'zeta'])
  })

  it('reporta a taxa global de fallback e a latência agregada', () => {
    const run = scoreRun([
      exec('a', [['x', true]], { latencyMs: 20_000, fellToFallback: true }),
      exec('a', [['x', true]], { latencyMs: 22_000 }),
      exec('b', [['x', true]], { latencyMs: 30_000 }),
      exec('b', [['x', true]], { latencyMs: 21_000 }),
    ])
    expect(run.fallbackRate).toBe(0.25)
    expect(run.latency.count).toBe(4)
    expect(run.latency.maxMs).toBe(30_000)
    expect(run.execucoesPorCenario).toBe(2)
  })

  it('lida com rodada vazia sem NaN', () => {
    const run = scoreRun([])
    expect(run.score).toBe(0)
    expect(run.fallbackRate).toBe(0)
    expect(run.scenarios).toEqual([])
  })
})

describe('pct', () => {
  it('formata o score em porcentagem', () => {
    expect(pct(0.8567)).toBe('85.7%')
    expect(pct(1)).toBe('100.0%')
  })
})
