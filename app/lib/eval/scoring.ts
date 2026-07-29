// Pontuação do banco de provas — PURO e testável (não chama LLM, não lê arquivo).
//
// Por que existe: o eval antigo era binário (o cenário passa ou quebra). Isso
// responde "quebrou?", mas não "melhorou ou piorou?" — e com LLM a resposta certa
// para essa segunda pergunta é uma NOTA, não um booleano.
//
// Duas ideias sustentam o desenho:
//
// 1. LLM não é determinístico. Uma rodada por cenário mede sorte. Rodamos N vezes
//    e guardamos a TAXA DE APROVAÇÃO de cada verificação — "passa 9 de 10" é
//    informação; "passou" não é. É também o que evita virar teste flaky no CI.
//
// 2. Nem toda verificação vale o mesmo. "Não vazou o prompt do sistema" não pode
//    ter tolerância a falha; "usou tom cordial" pode. Daí `peso` e `critico`.

import { type Summary, summarize } from '../metrics'

/** Uma verificação nomeada sobre a saída de um cenário. */
export type Check = {
  id: string
  /** Quanto essa verificação pesa no score do cenário. */
  peso: number
  /**
   * Verificação de segurança/guard-rail: qualquer falha em qualquer repetição é
   * regressão, sem tolerância estatística (ver baseline.ts).
   */
  critico?: boolean
}

/** Resultado de uma verificação numa execução. */
export type CheckResult = Check & { passou: boolean }

/** O que UMA execução de um cenário produziu. */
export type RunOutcome = {
  scenarioId: string
  checks: CheckResult[]
  latencyMs: number
  /** O cérebro caiu no fallback seguro (provider/validação) — não é resposta real. */
  fellToFallback: boolean
}

/** Como uma verificação se saiu ao longo das repetições. */
export type CheckScore = {
  id: string
  peso: number
  critico: boolean
  /** Fração de execuções em que passou (0..1). */
  taxa: number
  execucoes: number
}

/** Como um cenário se saiu ao longo das repetições. */
export type ScenarioScore = {
  scenarioId: string
  execucoes: number
  /** Média das taxas ponderada pelos pesos (0..1). Cenário sem check pontua 1. */
  score: number
  checks: CheckScore[]
  latency: Summary
  /** Fração de execuções que caíram no fallback (0..1). */
  fallbackRate: number
}

/** A rodada inteira. */
export type EvalRun = {
  /** Média simples dos scores dos cenários — cada cenário vale o mesmo. */
  score: number
  execucoesPorCenario: number
  scenarios: ScenarioScore[]
  latency: Summary
  fallbackRate: number
}

/** Arredonda para 4 casas — taxas como 2/3 não podem virar dízima no JSON do baseline. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * Agrega as N execuções de UM cenário. Todas as execuções precisam ser do mesmo
 * cenário; a lista não pode estar vazia.
 */
export function scoreScenario(outcomes: RunOutcome[]): ScenarioScore {
  if (outcomes.length === 0) {
    throw new Error('scoreScenario: sem execuções')
  }
  const scenarioId = outcomes[0].scenarioId

  // Agrupa por id de check. Um check ausente numa execução simplesmente não conta
  // ali (pode acontecer se o cenário mudar entre execuções).
  const porCheck = new Map<
    string,
    { peso: number; critico: boolean; passou: number; total: number }
  >()
  for (const outcome of outcomes) {
    for (const check of outcome.checks) {
      const atual = porCheck.get(check.id) ?? {
        peso: check.peso,
        critico: check.critico === true,
        passou: 0,
        total: 0,
      }
      atual.total += 1
      if (check.passou) {
        atual.passou += 1
      }
      porCheck.set(check.id, atual)
    }
  }

  const checks: CheckScore[] = [...porCheck.entries()].map(([id, dados]) => ({
    id,
    peso: dados.peso,
    critico: dados.critico,
    taxa: round4(dados.passou / dados.total),
    execucoes: dados.total,
  }))

  const pesoTotal = checks.reduce((soma, check) => soma + check.peso, 0)
  // Cenário sem verificação declarada é só revisão humana: não pune nem premia.
  const score =
    pesoTotal > 0
      ? round4(checks.reduce((soma, check) => soma + check.taxa * check.peso, 0) / pesoTotal)
      : 1

  const quedas = outcomes.filter((outcome) => outcome.fellToFallback).length

  return {
    scenarioId,
    execucoes: outcomes.length,
    score,
    checks: checks.sort((a, b) => a.id.localeCompare(b.id)),
    latency: summarize(outcomes.map((outcome) => outcome.latencyMs)),
    fallbackRate: round4(quedas / outcomes.length),
  }
}

/**
 * Agrega a rodada inteira. Cada CENÁRIO vale o mesmo no score global — senão um
 * cenário com muitas verificações dominaria a nota e um cenário crítico com uma
 * verificação só ficaria invisível.
 */
export function scoreRun(outcomes: RunOutcome[]): EvalRun {
  const porCenario = new Map<string, RunOutcome[]>()
  for (const outcome of outcomes) {
    const lista = porCenario.get(outcome.scenarioId)
    if (lista) {
      lista.push(outcome)
    } else {
      porCenario.set(outcome.scenarioId, [outcome])
    }
  }

  const scenarios = [...porCenario.values()]
    .map(scoreScenario)
    .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))

  const score =
    scenarios.length > 0
      ? round4(scenarios.reduce((soma, s) => soma + s.score, 0) / scenarios.length)
      : 0
  const quedas = outcomes.filter((outcome) => outcome.fellToFallback).length

  return {
    score,
    execucoesPorCenario: scenarios.length > 0 ? Math.max(...scenarios.map((s) => s.execucoes)) : 0,
    scenarios,
    latency: summarize(outcomes.map((outcome) => outcome.latencyMs)),
    fallbackRate: outcomes.length > 0 ? round4(quedas / outcomes.length) : 0,
  }
}

/** Nota em porcentagem, para relatório humano. */
export function pct(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}
