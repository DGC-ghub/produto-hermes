/**
 * GATE DE REGRESSÃO do motor — a régua de qualidade da IA.
 *
 * Roda cada cenário N vezes (LLM não é determinístico: uma rodada mede sorte),
 * pontua cada verificação pela TAXA DE APROVAÇÃO, compara com o baseline
 * versionado em `eval/baseline.json` e sai com código != 0 se houve regressão.
 *
 *   npm run eval:gate                      # 3 execuções por cenário
 *   npm run eval:gate -- --runs 5          # mais execuções = menos ruído, mais tempo
 *   npm run eval:gate -- --tenant csmed    # só um tenant
 *   npm run eval:baseline                  # promove a rodada atual a novo baseline
 *
 * Cada execução chama o modelo de verdade e leva ~20s. 26 cenários × 3 execuções
 * ≈ 26 min sequencial; a concorrência (default 2) casa com o semáforo do provider.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  type Baseline,
  compararComBaseline,
  parseBaseline,
  toBaseline,
  type Veredito,
} from '../app/lib/eval/baseline'
import { runScenario } from '../app/lib/eval/runner.server'
import { selectScenarios } from '../app/lib/eval/scenarios'
import { type EvalRun, pct, type RunOutcome, scoreRun } from '../app/lib/eval/scoring'
import { fmtSeconds } from '../app/lib/metrics'

// O gate testa o cérebro REAL.
process.env.ATTENDANT_PROVIDER ??= 'claude_cli'

const BASELINE_PATH = 'eval/baseline.json'
const RELATORIO_PATH = 'eval/ultima-rodada.md'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 ? process.argv[index + 1] : undefined
}

function numeroArg(name: string, envVar: string, padrao: number): number {
  const bruto = Number(arg(name) ?? process.env[envVar])
  return Number.isFinite(bruto) && bruto > 0 ? Math.floor(bruto) : padrao
}

/** Executa as tarefas com no máximo `limite` em voo. Preserva a ordem do resultado. */
async function comLimite<T>(tarefas: Array<() => Promise<T>>, limite: number): Promise<T[]> {
  const resultados: T[] = new Array(tarefas.length)
  let proxima = 0
  const trabalhadores = Array.from({ length: Math.min(limite, tarefas.length) }, async () => {
    while (proxima < tarefas.length) {
      const indice = proxima++
      resultados[indice] = await tarefas[indice]()
    }
  })
  await Promise.all(trabalhadores)
  return resultados
}

function lerBaseline(): Baseline | null {
  if (!existsSync(BASELINE_PATH)) {
    return null
  }
  // Sem try/catch de propósito: baseline corrompido tem que estourar. Tratar como
  // "sem baseline" faria o gate aprovar em silêncio justo quando perdeu a régua.
  return parseBaseline(readFileSync(BASELINE_PATH, 'utf8'))
}

function gravar(caminho: string, conteudo: string): void {
  mkdirSync(dirname(caminho), { recursive: true })
  writeFileSync(caminho, conteudo, 'utf8')
}

function relatorio(run: EvalRun, veredito: Veredito, baseline: Baseline | null): string {
  const linhas: string[] = [
    '# Gate de regressão do motor',
    '',
    `Provider: \`${process.env.ATTENDANT_PROVIDER}\` · modelo: \`${process.env.CLAUDE_MODEL ?? 'sonnet'}\``,
    `Cenários: **${run.scenarios.length}** × **${run.execucoesPorCenario}** execuções`,
    '',
    '## Resultado',
    '',
    `- Score: **${pct(run.score)}**${baseline ? ` (baseline ${pct(baseline.score)})` : ' (primeira rodada)'}`,
    `- Fallback: **${pct(run.fallbackRate)}**${run.fallbackRate > 0 ? ' ⚠️' : ''}`,
    `- Latência: p50 **${fmtSeconds(run.latency.p50Ms)}** · p95 **${fmtSeconds(run.latency.p95Ms)}** · max **${fmtSeconds(run.latency.maxMs)}**`,
    `- Veredito: **${veredito.aprovado ? '✅ APROVADO' : '❌ REGRESSÃO'}**`,
    '',
  ]

  if (veredito.regressoes.length > 0) {
    linhas.push('## Regressões', '')
    for (const r of veredito.regressoes) {
      linhas.push(`- **[${r.tipo}] ${r.alvo}**: ${pct(r.antes)} → ${pct(r.agora)} — ${r.mensagem}`)
    }
    linhas.push('')
  }
  if (veredito.melhorias.length > 0) {
    linhas.push('## Melhorias', '')
    for (const m of veredito.melhorias) {
      linhas.push(`- ${m.alvo}: ${pct(m.antes)} → ${pct(m.agora)}`)
    }
    linhas.push('')
  }
  if (veredito.novosCenarios.length > 0) {
    linhas.push(`## Cenários novos (sem baseline)`, '', veredito.novosCenarios.join(', '), '')
  }
  if (veredito.cenariosSumidos.length > 0) {
    linhas.push(`## Cenários que sumiram`, '', veredito.cenariosSumidos.join(', '), '')
  }

  linhas.push(
    '## Por cenário',
    '',
    '| Cenário | Score | p50 | Fallback | Verificações |',
    '|---|---|---|---|---|',
  )
  for (const s of run.scenarios) {
    const checks =
      s.checks.length > 0
        ? s.checks.map((c) => `${c.critico ? '🔒' : ''}${c.id}=${pct(c.taxa)}`).join('<br>')
        : '_(revisão humana)_'
    linhas.push(
      `| ${s.scenarioId} | ${pct(s.score)} | ${fmtSeconds(s.latency.p50Ms)} | ${pct(s.fallbackRate)} | ${checks} |`,
    )
  }
  linhas.push('', '🔒 = verificação crítica (guard-rail: sem tolerância a falha)', '')
  return linhas.join('\n')
}

async function main(): Promise<void> {
  const runs = numeroArg('runs', 'EVAL_RUNS', 3)
  const concorrencia = numeroArg('concorrencia', 'EVAL_CONCURRENCY', 2)
  const cenarios = selectScenarios(arg('tenant') ?? process.env.EVAL_TENANT)
  const promover = process.argv.includes('--promover')

  if (cenarios.length === 0) {
    console.error('Nenhum cenário selecionado — confira --tenant.')
    process.exit(1)
  }

  const total = cenarios.length * runs
  console.log(
    `Gate do motor · ${cenarios.length} cenários × ${runs} execuções = ${total} chamadas ` +
      `(provider=${process.env.ATTENDANT_PROVIDER}, concorrência=${concorrencia})\n`,
  )

  let concluidas = 0
  const tarefas: Array<() => Promise<RunOutcome>> = []
  for (let volta = 0; volta < runs; volta++) {
    for (const cenario of cenarios) {
      tarefas.push(async () => {
        const report = await runScenario(cenario)
        concluidas += 1
        const falhas = report.outcome.checks.filter((c) => !c.passou)
        const marca = report.fellToFallback ? '⚠️ FALLBACK' : falhas.length > 0 ? '✗' : 'ok'
        console.log(
          `[${String(concluidas).padStart(3)}/${total}] ${cenario.id.padEnd(26)} ${marca.padEnd(11)} ${fmtSeconds(report.ms)}` +
            (falhas.length > 0 ? `  (${falhas.map((f) => f.id).join(', ')})` : ''),
        )
        return report.outcome
      })
    }
  }

  const outcomes = await comLimite(tarefas, concorrencia)
  const run = scoreRun(outcomes)
  const baseline = lerBaseline()
  const veredito = compararComBaseline(run, baseline)

  const texto = relatorio(run, veredito, baseline)
  gravar(RELATORIO_PATH, texto)
  console.log(`\n${texto}`)
  console.log(`📄 Relatório em ${RELATORIO_PATH}`)

  if (promover) {
    if (!veredito.aprovado && !process.argv.includes('--forcar')) {
      console.error(
        '\n❌ Rodada com regressão: baseline NÃO promovido. Use --forcar se a queda for intencional.',
      )
      process.exit(1)
    }
    const novo = toBaseline(run, {
      provider: process.env.ATTENDANT_PROVIDER ?? 'desconhecido',
      modelo: process.env.CLAUDE_MODEL ?? 'sonnet',
      criadoEm: new Date().toISOString(),
    })
    gravar(BASELINE_PATH, `${JSON.stringify(novo, null, 2)}\n`)
    console.log(`\n✅ Baseline promovido: ${BASELINE_PATH} (score ${pct(novo.score)})`)
    console.log('   Commite o arquivo — é ele que trava a regressão daqui pra frente.')
    return
  }

  if (veredito.semBaseline) {
    console.log('\nℹ️  Sem baseline ainda. Rode `npm run eval:baseline` para gravar esta rodada.')
  }
  if (!veredito.aprovado) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
