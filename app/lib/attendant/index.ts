import { mockProvider } from './providers/mock'
import type { AttendantInput, AttendantOutput, AttendantProvider } from './types'
import { type TenantPolicy, validateAttendantOutput } from './validate'

const SAFE_FALLBACK_REPLY =
  'Vou marcar para uma pessoa do time te ajudar com segurança. Pode me dar mais contexto enquanto isso?'

// Saída segura quando o provider falha ou devolve algo que não passa no validador:
// nunca expõe erro cru ao cliente, sempre escala para humano.
function safeFallback(reason: string): AttendantOutput {
  return {
    reply: SAFE_FALLBACK_REPLY,
    needsHuman: true,
    handoffReason: reason,
    leadPatch: null,
    confidence: 0,
    action: null,
  }
}

// Escolhe o provider por env (ATTENDANT_PROVIDER). O provider de IA real é
// carregado sob demanda para não trazer dependências de servidor (child_process)
// quando se usa só o mock.
export async function resolveProvider(): Promise<AttendantProvider> {
  // Motor via assinatura pessoal do Claude (CLI logado na máquina).
  if (process.env.ATTENDANT_PROVIDER === 'claude_cli') {
    const { claudeCliProvider } = await import('./providers/claude-cli.server')
    return claudeCliProvider
  }
  // Motor via API da Anthropic (o cliente paga os tokens que usa).
  if (process.env.ATTENDANT_PROVIDER === 'anthropic_api') {
    const { anthropicApiProvider } = await import('./providers/anthropic-api.server')
    return anthropicApiProvider
  }
  return mockProvider
}

/**
 * Ponto de entrada do cérebro atendente. Escolhe o provider, chama-o e SEMPRE
 * valida a saída (aplicando a policy do tenant) antes de devolver. Em qualquer
 * falha devolve um fallback seguro que escala para humano.
 */
export async function generateAttendantReply(
  input: AttendantInput,
  opts: { provider?: AttendantProvider; policy?: TenantPolicy } = {},
): Promise<AttendantOutput> {
  const active = opts.provider ?? (await resolveProvider())

  let raw: AttendantOutput
  try {
    raw = await active.generate(input)
  } catch (error) {
    console.error(
      '[attendant] provider falhou -> fallback seguro:',
      error instanceof Error ? error.message : error,
    )
    return safeFallback('provider_error')
  }

  const result = validateAttendantOutput(raw, opts.policy)
  if (!result.ok) {
    console.warn(`[attendant] validação recusou a resposta (${result.reason}) -> fallback seguro`)
    // Diagnóstico pontual (tem PII do reply): só atrás da flag, nunca em produção.
    if (process.env.ATTENDANT_DEBUG === '1') {
      console.warn('[attendant] saída crua recusada:', JSON.stringify(raw))
    }
    return safeFallback('validacao_falhou')
  }
  return result.value
}

export type { AttendantInput, AttendantOutput, AttendantProvider } from './types'
