// Executa um cenário pelo MESMO caminho de uma mensagem real (config → regras →
// knowledge → retrieval → guard → cérebro validado), só que sem tocar o banco.
// É o "balcão" do Hermes num tubo de ensaio.
//
// Server-side: chama o provider real (spawn do claude CLI ou API).

import { generateAttendantReply } from '../attendant'
import { buildCompanyRules } from '../attendant/rules'
import { loadTenantConfig } from '../attendant/tenant-config'
import type { AttendantOutput } from '../attendant/types'
import { decideHandoff } from '../handoff'
import { loadKnowledgeFromSource } from '../knowledge.server'
import { retrieveRelevantChunks } from '../retrieval'
import { avaliarCenario } from './checks'
import type { Scenario } from './scenarios'
import type { RunOutcome } from './scoring'

export type ScenarioReport = {
  scenario: Scenario
  decision: AttendantOutput
  guardReason: string | undefined
  guardForcesSafe: boolean
  needsHumanFinal: boolean
  replyFinal: string
  retrieved: { fileName: string; score: number }[]
  fellToFallback: boolean
  ms: number
  /** Verificações desta execução, prontas para pontuar. */
  outcome: RunOutcome
}

export async function runScenario(s: Scenario): Promise<ScenarioReport> {
  const config = loadTenantConfig(s.tenant)
  const companyRules = buildCompanyRules(config)
  const enabledTools = config.tools
    .filter((tool) => tool.enabled)
    .map((tool) => ({ name: tool.name, limits: tool.limits }))
  const docs = await loadKnowledgeFromSource(config.knowledge.sourceDir)
  const retrieved = retrieveRelevantChunks(s.message, docs)
  const guard = decideHandoff({
    message: s.message,
    retrievedCount: retrieved.length,
    extraSensitiveTriggers: config.escalationPolicy.triggers,
  })

  const start = Date.now()
  const decision = await generateAttendantReply(
    {
      tenant: { slug: s.tenant, name: config.businessProfile.name },
      companyRules,
      enabledTools: enabledTools.map((tool) => tool.name),
      knowledge: retrieved.map((chunk) => ({ title: chunk.title, snippet: chunk.snippet })),
      history: s.history ?? [],
      lead: s.lead ?? null,
      myTickets: s.tickets ?? [],
      message: s.message,
    },
    {
      policy: {
        extraForbiddenClaims: config.guardrails.neverPromise,
        tools: enabledTools,
      },
    },
  )
  const ms = Date.now() - start

  // Combinação determinística idêntica à de conversation.server.ts: o guard
  // curto-circuita o cérebro, então é a resposta segura que vale.
  const guardForcesSafe = guard.reason === 'requested_human' || guard.reason === 'sensitive_topic'
  const needsHumanFinal = guardForcesSafe || decision.needsHuman
  const replyFinal = guardForcesSafe ? config.escalationPolicy.humanMessage : decision.reply
  const fellToFallback =
    decision.handoffReason === 'provider_error' || decision.handoffReason === 'validacao_falhou'

  return {
    scenario: s,
    decision,
    guardReason: guard.reason,
    guardForcesSafe,
    needsHumanFinal,
    replyFinal,
    retrieved: retrieved.map((chunk) => ({ fileName: chunk.fileName, score: chunk.score })),
    fellToFallback,
    ms,
    outcome: {
      scenarioId: s.id,
      // O guard curto-circuita a ação também — chamado proposto ali nunca é executado.
      checks: avaliarCenario(s.espera, {
        needsHumanFinal,
        abriuChamado: !guardForcesSafe && decision.action?.type === 'abrir_chamado',
        replyFinal,
      }),
      latencyMs: ms,
      fellToFallback,
    },
  }
}

/** Um cartão em Markdown por execução — o canal de revisão HUMANA do relatório. */
export function renderCard(r: ScenarioReport): string {
  const s = r.scenario
  const sources =
    r.retrieved.length > 0
      ? r.retrieved.map((c) => `${c.fileName}(${c.score})`).join(', ')
      : '(nenhum trecho recuperado)'
  const act = r.decision.action
  const action =
    act?.type === 'abrir_chamado'
      ? `abrir_chamado — "${act.subject}"`
      : act
        ? `pedir_agendamento — ${act.operation}`
        : '(nenhuma)'
  const lead = r.decision.leadPatch ? JSON.stringify(r.decision.leadPatch) : '(nenhum)'
  return [
    `### [${s.id}] ${s.titulo}  ·  ${r.ms}ms${r.fellToFallback ? '  ⚠️ FALLBACK' : ''}`,
    `- **Por quê:** ${s.porque}`,
    `- **Cliente:** "${s.message}"`,
    `- **RAG:** ${sources}`,
    `- **Guard:** ${r.guardReason ?? 'ok'}${r.guardForcesSafe ? ' (força resposta segura)' : ''}`,
    `- **Escala:** modelo=${r.decision.needsHuman} → final=${r.needsHumanFinal}` +
      `${r.decision.handoffReason ? ` (${r.decision.handoffReason})` : ''}`,
    `- **Ação:** ${action}`,
    `- **Lead:** ${lead}   ·   confiança: ${r.decision.confidence}`,
    '- **RESPOSTA:**',
    '',
    r.replyFinal
      .split('\n')
      .map((line) => `  > ${line}`)
      .join('\n'),
  ].join('\n')
}
