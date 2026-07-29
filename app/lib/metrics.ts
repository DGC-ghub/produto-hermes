// Núcleo de medição de latência do Hermes — PURO e testável (sem banco, sem env).
// A parte que grava/lê fica em `metrics.server.ts`.
//
// Por quê: o motor leva ~20s por mensagem e até aqui só sabíamos disso por
// `console.log` solto no provider. Sem quebrar o tempo POR ETAPA não dá pra
// dizer se o gargalo é o LLM, o SQLite do Pi ou a montagem do contexto — e sem
// percentil não dá pra afirmar que uma mudança melhorou (média esconde a cauda,
// e é a cauda que o cliente sente no WhatsApp).

/** Duração de cada etapa nomeada, em milissegundos. */
export type StepDurations = Record<string, number>

export type TraceResult = {
  totalMs: number
  steps: StepDurations
}

export type Timer = {
  /** Mede uma etapa assíncrona. A duração é registrada mesmo se `fn` lançar. */
  step<T>(name: string, fn: () => Promise<T>): Promise<T>
  /** Mede uma etapa síncrona (ex.: o RAG lexical, que é CPU pura). */
  stepSync<T>(name: string, fn: () => T): T
  /** Fecha o trace: total desde a criação e o mapa de etapas. */
  finish(): TraceResult
}

/** Arredonda para 1 casa decimal — etapas de banco no Pi ficam abaixo de 1ms. */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Cria um cronômetro de etapas. O relógio é injetável para o teste ser
 * determinístico; em produção usa `performance.now()` (monotônico — não anda
 * pra trás se o NTP ajustar o relógio no meio de uma mensagem, o que com
 * `Date.now()` daria duração negativa).
 *
 * Etapas repetidas SOMAM: se a mesma etapa roda duas vezes numa mensagem,
 * queremos o custo total dela, não a última ocorrência.
 */
export function createTimer(now: () => number = () => performance.now()): Timer {
  const startedAt = now()
  const steps: StepDurations = {}

  function add(name: string, elapsed: number): void {
    steps[name] = round1((steps[name] ?? 0) + elapsed)
  }

  return {
    async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const begin = now()
      try {
        return await fn()
      } finally {
        add(name, now() - begin)
      }
    },
    stepSync<T>(name: string, fn: () => T): T {
      const begin = now()
      try {
        return fn()
      } finally {
        add(name, now() - begin)
      }
    },
    finish(): TraceResult {
      return { totalMs: round1(now() - startedAt), steps }
    },
  }
}

/**
 * Percentil pelo método nearest-rank (sem interpolação): o valor devolvido é
 * sempre uma medição REAL que aconteceu, não uma média entre duas. Para latência
 * isso é o que se quer — "p95 = 30,7s" significa que alguém esperou 30,7s.
 * `p` vai de 0 a 100. Devolve 0 para lista vazia.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1)
  return sorted[index]
}

export type Summary = {
  count: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
}

/** Resumo estatístico de uma lista de durações. Puro. */
export function summarize(values: number[]): Summary {
  if (values.length === 0) {
    return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 }
  }
  const total = values.reduce((acc, value) => acc + value, 0)
  return {
    count: values.length,
    avgMs: round1(total / values.length),
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    p99Ms: percentile(values, 99),
    maxMs: Math.max(...values),
  }
}

export type LatencyReport = {
  /** Janela observada, em minutos (só para rotular o relatório). */
  windowMinutes: number
  /** Ponta a ponta, do recebimento à resposta pronta. */
  total: Summary
  /** Por etapa do fluxo (brain, knowledge, retrieval...). */
  steps: Record<string, Summary>
  /** Quantas mensagens terminaram em cada desfecho (ok, fallback, handoff...). */
  outcomes: Record<string, number>
  /** Quantas mensagens cada provider de cérebro atendeu. */
  providers: Record<string, number>
}

/** Uma medição de mensagem, já desserializada. */
export type TraceSample = {
  totalMs: number
  steps: StepDurations
  outcome: string
  provider: string
}

/**
 * Agrega uma janela de medições num relatório. Puro — recebe as amostras
 * prontas, sem tocar no banco, o que deixa a estatística testável sem fixture.
 */
export function buildReport(samples: TraceSample[], windowMinutes: number): LatencyReport {
  const byStep = new Map<string, number[]>()
  const outcomes: Record<string, number> = {}
  const providers: Record<string, number> = {}

  for (const sample of samples) {
    outcomes[sample.outcome] = (outcomes[sample.outcome] ?? 0) + 1
    providers[sample.provider] = (providers[sample.provider] ?? 0) + 1
    for (const [name, duration] of Object.entries(sample.steps)) {
      const bucket = byStep.get(name)
      if (bucket) {
        bucket.push(duration)
      } else {
        byStep.set(name, [duration])
      }
    }
  }

  const steps: Record<string, Summary> = {}
  for (const [name, durations] of byStep) {
    steps[name] = summarize(durations)
  }

  return {
    windowMinutes,
    total: summarize(samples.map((sample) => sample.totalMs)),
    steps,
    outcomes,
    providers,
  }
}

/** Escapa um valor de label conforme o exposition format do Prometheus. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/**
 * Serializa o relatório no text exposition format do Prometheus. Escolhemos
 * `gauge` com label `quantile` (em vez do tipo `summary`) porque os percentis já
 * vêm calculados do banco: é honesto expor o número pronto, e o Grafana lê
 * gauge sem cerimônia. Zero dependência nova — é só string.
 */
export function formatPrometheus(report: LatencyReport): string {
  const lines: string[] = []

  lines.push('# HELP hermes_messages_total Mensagens processadas na janela, por desfecho.')
  lines.push('# TYPE hermes_messages_total gauge')
  for (const [outcome, count] of Object.entries(report.outcomes).sort()) {
    lines.push(`hermes_messages_total{outcome="${escapeLabel(outcome)}"} ${count}`)
  }

  lines.push('# HELP hermes_messages_by_provider Mensagens por provider do cérebro.')
  lines.push('# TYPE hermes_messages_by_provider gauge')
  for (const [provider, count] of Object.entries(report.providers).sort()) {
    lines.push(`hermes_messages_by_provider{provider="${escapeLabel(provider)}"} ${count}`)
  }

  const quantiles: Array<[string, keyof Summary]> = [
    ['0.5', 'p50Ms'],
    ['0.95', 'p95Ms'],
    ['0.99', 'p99Ms'],
  ]

  lines.push('# HELP hermes_message_duration_ms Latência ponta a ponta de uma mensagem.')
  lines.push('# TYPE hermes_message_duration_ms gauge')
  for (const [label, key] of quantiles) {
    lines.push(`hermes_message_duration_ms{quantile="${label}"} ${report.total[key]}`)
  }
  lines.push(`hermes_message_duration_ms_max ${report.total.maxMs}`)
  lines.push(`hermes_message_duration_ms_avg ${report.total.avgMs}`)

  lines.push('# HELP hermes_step_duration_ms Latência de cada etapa do fluxo.')
  lines.push('# TYPE hermes_step_duration_ms gauge')
  for (const [name, summary] of Object.entries(report.steps).sort()) {
    for (const [label, key] of quantiles) {
      lines.push(
        `hermes_step_duration_ms{step="${escapeLabel(name)}",quantile="${label}"} ${summary[key]}`,
      )
    }
  }

  return `${lines.join('\n')}\n`
}

/**
 * Relatório em texto para o terminal — é o que se lê no Pi por SSH quando se
 * quer saber "onde foram os 20 segundos?" sem subir Grafana.
 */
export function formatTextReport(report: LatencyReport): string {
  if (report.total.count === 0) {
    return `Sem mensagens nos últimos ${report.windowMinutes} min.`
  }
  const lines: string[] = [
    `Janela: ${report.windowMinutes} min · ${report.total.count} mensagem(ns)`,
    `Total: p50 ${fmtSeconds(report.total.p50Ms)} · p95 ${fmtSeconds(report.total.p95Ms)} · max ${fmtSeconds(report.total.maxMs)}`,
    '',
    'Etapa                    p50        p95        share(p50)',
  ]
  const entries = Object.entries(report.steps).sort((a, b) => b[1].p50Ms - a[1].p50Ms)
  for (const [name, summary] of entries) {
    const share = report.total.p50Ms > 0 ? (summary.p50Ms / report.total.p50Ms) * 100 : 0
    lines.push(
      `${name.padEnd(22)} ${fmtSeconds(summary.p50Ms).padStart(9)}  ${fmtSeconds(summary.p95Ms).padStart(9)}  ${share.toFixed(1).padStart(6)}%`,
    )
  }
  return lines.join('\n')
}

/** Formata ms como "1.2s" acima de 1s, senão "340ms". */
export function fmtSeconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}
