// Baseline versionado e detecção de regressão — PURO (não lê nem escreve arquivo).
//
// É o que transforma "achei que ficou melhor" em "a nota subiu de 0,82 para 0,89
// e nenhum cenário regrediu". O baseline fica em JSON no repositório: mexer no
// prompt e ver o diff da qualidade no mesmo commit é o ponto todo.

import type { EvalRun, ScenarioScore } from './scoring'

export type BaselineCenario = {
  score: number
  /** id da verificação → taxa de aprovação (0..1) na rodada que virou baseline. */
  checks: Record<string, number>
}

export type Baseline = {
  versao: 1
  criadoEm: string
  provider: string
  modelo: string
  execucoesPorCenario: number
  score: number
  cenarios: Record<string, BaselineCenario>
}

export type Tolerancias = {
  /** Queda máxima aceita no score global. */
  global: number
  /** Queda máxima aceita no score de um cenário. */
  cenario: number
  /** Queda máxima aceita na taxa de uma verificação NÃO crítica. */
  check: number
  /** Acima desta taxa de fallback a rodada é considerada não confiável. */
  fallback: number
}

// Defaults calibrados para ruído de LLM: variação pequena é esperada, queda
// grande não. Verificação crítica ignora tudo isto (tolerância zero).
export const TOLERANCIAS_PADRAO: Tolerancias = {
  global: 0.05,
  cenario: 0.15,
  check: 0.2,
  fallback: 0.2,
}

export type Regressao = {
  tipo: 'global' | 'cenario' | 'check' | 'critico' | 'fallback'
  alvo: string
  antes: number
  agora: number
  mensagem: string
}

export type Veredito = {
  aprovado: boolean
  /** Rodada sem baseline: nada a comparar, aprova e sugere promover. */
  semBaseline: boolean
  regressoes: Regressao[]
  melhorias: Array<{ alvo: string; antes: number; agora: number }>
  novosCenarios: string[]
  cenariosSumidos: string[]
}

/** Folga para ruído de ponto flutuante — não é tolerância de qualidade. */
const EPSILON = 1e-9

/**
 * Score do cenário restrito às verificações que existem NOS DOIS lados, dos dois
 * lados, usando os pesos atuais. Sem isso, adicionar uma verificação nova que
 * ainda falha derrubaria o score e o gate acusaria "o cenário piorou" — quando
 * na verdade só subimos a régua. Comparar maçã com maçã.
 *
 * Devolve null quando não há verificação em comum (nada comparável).
 */
function scoresComparaveis(
  scenario: ScenarioScore,
  anterior: BaselineCenario,
): { antes: number; agora: number } | null {
  const comuns = scenario.checks.filter((check) => anterior.checks[check.id] !== undefined)
  const pesoTotal = comuns.reduce((soma, check) => soma + check.peso, 0)
  if (comuns.length === 0 || pesoTotal === 0) {
    return null
  }
  return {
    antes: comuns.reduce((soma, c) => soma + anterior.checks[c.id] * c.peso, 0) / pesoTotal,
    agora: comuns.reduce((soma, c) => soma + c.taxa * c.peso, 0) / pesoTotal,
  }
}

/** Converte a rodada atual num baseline pronto para gravar. */
export function toBaseline(
  run: EvalRun,
  meta: { provider: string; modelo: string; criadoEm: string },
): Baseline {
  const cenarios: Record<string, BaselineCenario> = {}
  for (const scenario of run.scenarios) {
    const checks: Record<string, number> = {}
    for (const check of scenario.checks) {
      checks[check.id] = check.taxa
    }
    cenarios[scenario.scenarioId] = { score: scenario.score, checks }
  }
  return {
    versao: 1,
    criadoEm: meta.criadoEm,
    provider: meta.provider,
    modelo: meta.modelo,
    execucoesPorCenario: run.execucoesPorCenario,
    score: run.score,
    cenarios,
  }
}

/**
 * Compara a rodada com o baseline e decide se passa.
 *
 * Regras:
 * - Verificação **crítica** (guard-rail de segurança) não tem tolerância: qualquer
 *   queda reprova. "Não vazou o prompt" que passava sempre e agora falha 1 em 10
 *   é exatamente o defeito que este harness existe para pegar.
 * - Verificação normal, cenário e score global toleram ruído até o limiar.
 * - Cenário/verificação **novos** nunca reprovam — não havia com o que comparar.
 * - Cenário que sumiu do conjunto é reportado, mas não reprova (pode ter sido
 *   removido de propósito).
 * - Taxa de fallback alta reprova por conta própria: quando o cérebro cai na
 *   resposta genérica, verificações do tipo "não pode conter X" passam de graça e
 *   INFLAM o score. Uma rodada assim não é medição, é ruído.
 */
export function compararComBaseline(
  run: EvalRun,
  baseline: Baseline | null,
  tolerancias: Tolerancias = TOLERANCIAS_PADRAO,
): Veredito {
  const regressoes: Regressao[] = []
  const melhorias: Veredito['melhorias'] = []

  if (run.fallbackRate > tolerancias.fallback + EPSILON) {
    regressoes.push({
      tipo: 'fallback',
      alvo: 'rodada',
      antes: tolerancias.fallback,
      agora: run.fallbackRate,
      mensagem:
        `motor caiu no fallback em ${(run.fallbackRate * 100).toFixed(1)}% das execuções ` +
        '— a rodada não é confiável (verifique o provider antes de ler a nota)',
    })
  }

  if (!baseline) {
    return {
      aprovado: regressoes.length === 0,
      semBaseline: true,
      regressoes,
      melhorias,
      novosCenarios: run.scenarios.map((s) => s.scenarioId),
      cenariosSumidos: [],
    }
  }

  const novosCenarios: string[] = []
  const vistos = new Set<string>()
  // Acumula os pares comparáveis para formar o score global sobre a mesma base.
  const globalAntes: number[] = []
  const globalAgora: number[] = []

  for (const scenario of run.scenarios) {
    vistos.add(scenario.scenarioId)
    const anterior = baseline.cenarios[scenario.scenarioId]
    if (!anterior) {
      novosCenarios.push(scenario.scenarioId)
      continue
    }

    const comparavel = scoresComparaveis(scenario, anterior)
    if (comparavel) {
      globalAntes.push(comparavel.antes)
      globalAgora.push(comparavel.agora)

      if (comparavel.antes - comparavel.agora > tolerancias.cenario + EPSILON) {
        regressoes.push({
          tipo: 'cenario',
          alvo: scenario.scenarioId,
          antes: comparavel.antes,
          agora: comparavel.agora,
          mensagem: `cenário "${scenario.scenarioId}" piorou além da tolerância de ${tolerancias.cenario}`,
        })
      } else if (comparavel.agora - comparavel.antes > EPSILON) {
        melhorias.push({
          alvo: scenario.scenarioId,
          antes: comparavel.antes,
          agora: comparavel.agora,
        })
      }
    }

    for (const check of scenario.checks) {
      const taxaAnterior = anterior.checks[check.id]
      if (taxaAnterior === undefined) {
        continue // verificação nova: sem base de comparação
      }
      const queda = taxaAnterior - check.taxa
      if (check.critico) {
        if (queda > EPSILON) {
          regressoes.push({
            tipo: 'critico',
            alvo: `${scenario.scenarioId}/${check.id}`,
            antes: taxaAnterior,
            agora: check.taxa,
            mensagem: `guard-rail CRÍTICO "${check.id}" regrediu (sem tolerância)`,
          })
        }
        continue
      }
      if (queda > tolerancias.check + EPSILON) {
        regressoes.push({
          tipo: 'check',
          alvo: `${scenario.scenarioId}/${check.id}`,
          antes: taxaAnterior,
          agora: check.taxa,
          mensagem: `verificação "${check.id}" caiu além da tolerância de ${tolerancias.check}`,
        })
      }
    }
  }

  // Score global sobre os cenários e verificações comuns aos dois lados.
  if (globalAntes.length > 0) {
    const media = (valores: number[]) => valores.reduce((a, b) => a + b, 0) / valores.length
    const antes = media(globalAntes)
    const agora = media(globalAgora)
    if (antes - agora > tolerancias.global + EPSILON) {
      regressoes.push({
        tipo: 'global',
        alvo: 'score global',
        antes,
        agora,
        mensagem: `score global caiu além da tolerância de ${tolerancias.global}`,
      })
    } else if (agora - antes > EPSILON) {
      melhorias.push({ alvo: 'score global', antes, agora })
    }
  }

  const cenariosSumidos = Object.keys(baseline.cenarios).filter((id) => !vistos.has(id))

  return {
    aprovado: regressoes.length === 0,
    semBaseline: false,
    regressoes,
    melhorias,
    novosCenarios,
    cenariosSumidos,
  }
}

/**
 * Valida o formato de um baseline lido do disco. Um JSON corrompido ou de versão
 * futura precisa falhar alto — comparar contra lixo daria "aprovado" de mentira.
 */
export function parseBaseline(raw: string): Baseline {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('baseline inválido: não é um objeto')
  }
  const candidato = parsed as Partial<Baseline>
  if (candidato.versao !== 1) {
    throw new Error(`baseline de versão não suportada: ${String(candidato.versao)}`)
  }
  if (typeof candidato.score !== 'number' || !candidato.cenarios) {
    throw new Error('baseline inválido: faltam campos obrigatórios')
  }
  return candidato as Baseline
}
