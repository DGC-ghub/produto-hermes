import { describe, expect, it } from 'vitest'
import {
  buildReport,
  createTimer,
  fmtSeconds,
  formatPrometheus,
  formatTextReport,
  percentile,
  summarize,
  type TraceSample,
} from './metrics'

/** Relógio falso: avança só quando mandamos, para o teste não depender do tempo real. */
function fakeClock() {
  let current = 0
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe('createTimer', () => {
  it('mede cada etapa e o total', async () => {
    const clock = fakeClock()
    const timer = createTimer(clock.now)

    await timer.step('brain', async () => {
      clock.advance(20_000)
    })
    timer.stepSync('retrieval', () => {
      clock.advance(35)
    })
    clock.advance(5) // tempo fora de qualquer etapa (overhead do orquestrador)

    const result = timer.finish()
    expect(result.steps).toEqual({ brain: 20_000, retrieval: 35 })
    expect(result.totalMs).toBe(20_040)
  })

  it('devolve o valor da função medida', async () => {
    const timer = createTimer(fakeClock().now)
    await expect(timer.step('x', async () => 'valor')).resolves.toBe('valor')
    expect(timer.stepSync('y', () => 42)).toBe(42)
  })

  it('registra a duração mesmo quando a etapa lança', async () => {
    const clock = fakeClock()
    const timer = createTimer(clock.now)

    await expect(
      timer.step('brain', async () => {
        clock.advance(30_000)
        throw new Error('provider caiu')
      }),
    ).rejects.toThrow('provider caiu')

    // O caso lento é justamente o que falha por timeout — perder essa medição
    // esconderia o pior cenário do relatório.
    expect(timer.finish().steps.brain).toBe(30_000)
  })

  it('soma etapas repetidas em vez de sobrescrever', async () => {
    const clock = fakeClock()
    const timer = createTimer(clock.now)
    await timer.step('db', async () => clock.advance(10))
    await timer.step('db', async () => clock.advance(15))
    expect(timer.finish().steps.db).toBe(25)
  })

  it('arredonda para 1 casa (etapas de banco ficam abaixo de 1ms)', async () => {
    const clock = fakeClock()
    const timer = createTimer(clock.now)
    await timer.step('db', async () => clock.advance(0.44))
    expect(timer.finish().steps.db).toBe(0.4)
  })
})

describe('percentile', () => {
  it('usa nearest-rank: devolve uma medição real, sem interpolar', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(percentile(values, 50)).toBe(50)
    expect(percentile(values, 95)).toBe(100)
    expect(percentile(values, 100)).toBe(100)
  })

  it('não depende da ordem de entrada', () => {
    expect(percentile([90, 10, 50, 30, 70], 50)).toBe(50)
  })

  it('devolve 0 para lista vazia', () => {
    expect(percentile([], 95)).toBe(0)
  })

  it('funciona com uma única amostra', () => {
    expect(percentile([42], 95)).toBe(42)
  })
})

describe('summarize', () => {
  it('resume contagem, média, percentis e máximo', () => {
    const s = summarize([100, 200, 300, 400])
    expect(s.count).toBe(4)
    expect(s.avgMs).toBe(250)
    expect(s.p50Ms).toBe(200)
    expect(s.maxMs).toBe(400)
  })

  it('devolve zeros para lista vazia (sem NaN)', () => {
    expect(summarize([])).toEqual({ count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 })
  })
})

const samples: TraceSample[] = [
  {
    totalMs: 21_000,
    steps: { brain: 20_500, retrieval: 40 },
    outcome: 'ok',
    provider: 'claude_cli',
  },
  {
    totalMs: 30_700,
    steps: { brain: 30_000, retrieval: 60 },
    outcome: 'ok',
    provider: 'claude_cli',
  },
  { totalMs: 120, steps: { retrieval: 30 }, outcome: 'guard_handoff', provider: 'nenhum' },
]

describe('buildReport', () => {
  it('agrega total, etapas, desfechos e providers', () => {
    const report = buildReport(samples, 60)
    expect(report.total.count).toBe(3)
    expect(report.steps.brain.count).toBe(2) // a mensagem barrada pelo guard não chamou o cérebro
    expect(report.steps.retrieval.count).toBe(3)
    expect(report.outcomes).toEqual({ ok: 2, guard_handoff: 1 })
    expect(report.providers).toEqual({ claude_cli: 2, nenhum: 1 })
    expect(report.windowMinutes).toBe(60)
  })

  it('lida com janela vazia', () => {
    const report = buildReport([], 60)
    expect(report.total.count).toBe(0)
    expect(report.steps).toEqual({})
  })
})

describe('formatPrometheus', () => {
  it('emite exposition format com labels de etapa e quantil', () => {
    const text = formatPrometheus(buildReport(samples, 60))
    expect(text).toContain('# TYPE hermes_message_duration_ms gauge')
    expect(text).toContain('hermes_messages_total{outcome="ok"} 2')
    expect(text).toContain('hermes_messages_by_provider{provider="claude_cli"} 2')
    expect(text).toContain('hermes_step_duration_ms{step="brain",quantile="0.5"} 20500')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('escapa aspas em label (nome de etapa nunca quebra o formato)', () => {
    const text = formatPrometheus(
      buildReport([{ totalMs: 1, steps: { 'a"b': 1 }, outcome: 'ok', provider: 'mock' }], 60),
    )
    expect(text).toContain('step="a\\"b"')
  })
})

describe('formatTextReport', () => {
  it('ordena as etapas da mais cara para a mais barata e mostra o peso de cada uma', () => {
    const text = formatTextReport(buildReport(samples, 60))
    expect(text.indexOf('brain')).toBeLessThan(text.indexOf('retrieval'))
    expect(text).toContain('3 mensagem(ns)')
  })

  it('avisa quando não houve tráfego', () => {
    expect(formatTextReport(buildReport([], 15))).toBe('Sem mensagens nos últimos 15 min.')
  })
})

describe('fmtSeconds', () => {
  it('usa segundos acima de 1s e ms abaixo', () => {
    expect(fmtSeconds(21_700)).toBe('21.7s')
    expect(fmtSeconds(340)).toBe('340ms')
  })
})
