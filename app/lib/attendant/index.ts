import { mockProvider } from './providers/mock'
import type { AttendantInput, AttendantOutput, AttendantProvider } from './types'
import { validateAttendantOutput } from './validate'

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
  if (process.env.ATTENDANT_PROVIDER === 'claude_cli') {
    const { claudeCliProvider } = await import('./providers/claude-cli.server')
    return claudeCliProvider
  }
  return mockProvider
}

/**
 * Ponto de entrada do cérebro atendente. Escolhe o provider por env, chama-o e
 * SEMPRE valida a saída antes de devolver. Em qualquer falha devolve um fallback
 * seguro que escala para humano.
 */
export async function generateAttendantReply(
  input: AttendantInput,
  provider?: AttendantProvider,
): Promise<AttendantOutput> {
  const active = provider ?? (await resolveProvider())

  let raw: AttendantOutput
  try {
    raw = await active.generate(input)
  } catch {
    return safeFallback('provider_error')
  }

  const result = validateAttendantOutput(raw)
  return result.ok ? result.value : safeFallback('validacao_falhou')
}

export type { AttendantInput, AttendantOutput, AttendantProvider } from './types'
