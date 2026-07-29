import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { renderCard, runScenario, type ScenarioReport } from '../app/lib/eval/runner.server'
import { selectScenarios } from '../app/lib/eval/scenarios'

// ────────────────────────────────────────────────────────────────────────────
// BANCO DE PROVAS DO MOTOR — modo REVISÃO HUMANA
//
// Roda cada cenário UMA vez e imprime a conversa inteira (RAG, guard, escala,
// ação, resposta) para leitura. Serve para VER a IA respondendo.
//
// Para medir REGRESSÃO ao longo do tempo, use `npm run eval:gate`: repete cada
// cenário N vezes, pontua e compara com o baseline versionado. Aqui uma falha é
// um sinal para olhar; lá é um gate.
//
// Uso: `npm run eval:motor`  (usa o provider real; requer claude_cli logado)
// ────────────────────────────────────────────────────────────────────────────

// O ponto do banco de provas é testar o cérebro REAL. Default para claude_cli.
process.env.ATTENDANT_PROVIDER ??= 'claude_cli'

const reports: ScenarioReport[] = []
const ACTIVE_SCENARIOS = selectScenarios(process.env.EVAL_TENANT)

describe('banco de provas do motor', () => {
  for (const scenario of ACTIVE_SCENARIOS) {
    it(`[${scenario.id}] ${scenario.titulo}`, async () => {
      const r = await runScenario(scenario)
      reports.push(r)
      console.log(`\n${renderCard(r)}`)

      // As verificações são as MESMAS do gate (app/lib/eval/checks.ts) — os dois
      // modos nunca divergem sobre o que é comportamento correto.
      for (const check of r.outcome.checks) {
        expect(check.passou, `${scenario.id}: verificação "${check.id}" falhou`).toBe(true)
      }
    })
  }

  afterAll(() => {
    if (reports.length === 0) return
    const total = reports.length
    const escalou = reports.filter((r) => r.needsHumanFinal).length
    const abriu = reports.filter((r) => r.decision.action).length
    const fallback = reports.filter((r) => r.fellToFallback).length
    const maxMs = Math.max(...reports.map((r) => r.ms))
    const avgMs = Math.round(reports.reduce((sum, r) => sum + r.ms, 0) / total)

    const summary = [
      '# Banco de provas do motor — relatório',
      '',
      `Provider: \`${process.env.ATTENDANT_PROVIDER}\` · modelo: \`${process.env.CLAUDE_MODEL ?? 'sonnet'}\``,
      '',
      '## Resumo',
      `- Cenários: **${total}**`,
      `- Escalaram: **${escalou}**`,
      `- Abriram chamado: **${abriu}**`,
      `- Fallback (provider/validação falhou): **${fallback}**${fallback > 0 ? ' ⚠️' : ''}`,
      `- Latência: **${avgMs}ms** média · **${maxMs}ms** pior caso`,
      '',
      '## Cenários',
      '',
      ...reports.map(renderCard),
      '',
    ].join('\n\n')

    // Canal confiável: o vitest engole console.log quando tudo passa. O arquivo sempre fica.
    const path = 'eval-report.md'
    writeFileSync(path, summary, 'utf8')
    console.log(`\n📄 Relatório completo escrito em ${path}`)
  })
})
