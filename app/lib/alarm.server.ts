// Alarme de degradação do motor. Dispara quando o cérebro CAI no fallback seguro
// (provider_error / validacao_falhou) e o cliente recebe a resposta genérica — sem
// isto, o Hermes degrada em SILÊNCIO (foi o que aconteceu com o bug `spawn claude
// ENOENT`). Best-effort: nunca quebra o atendimento. Server-side.

const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000 // 10 min

function cooldownMs(): number {
  const raw = Number(process.env.ALARM_COOLDOWN_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COOLDOWN_MS
}

export type AlarmState = { lastSentAt: number | null; suppressed: number }

export type AlarmDecision =
  | { send: true; suppressed: number; state: AlarmState }
  | { send: false; state: AlarmState }

/**
 * Decide se o alarme dispara AGORA ou coalesce dentro do cooldown. Pura e testável.
 * Evita spam: se o claude deslogar, toda mensagem falha — mandamos 1 alarme e
 * contamos os suprimidos, reportando o total no próximo disparo.
 */
export function decideAlarm(
  now: number,
  state: AlarmState,
  cooldown: number = cooldownMs(),
): AlarmDecision {
  if (state.lastSentAt !== null && now - state.lastSentAt < cooldown) {
    return {
      send: false,
      state: { lastSentAt: state.lastSentAt, suppressed: state.suppressed + 1 },
    }
  }
  return {
    send: true,
    suppressed: state.suppressed,
    state: { lastSentAt: now, suppressed: 0 },
  }
}

/** Mensagem do alarme (pura). Inclui os disparos suprimidos no intervalo. */
export function formatAlarm(reason: string, suppressed: number): string {
  const extra = suppressed > 0 ? ` (+${suppressed} falha(s) suprimida(s) no intervalo)` : ''
  if (reason === 'envio_whatsapp_falhou') {
    return `[ALARM] Hermes gerou a resposta mas o ENVIO pelo WhatsApp falhou (envio_whatsapp_falhou)${extra}. O cliente ficou SEM resposta — verifique token/número no painel da Meta (detalhe no hermes.log).`
  }
  return `[ALARM] Hermes degradou: o motor caiu no fallback (${reason})${extra}. O cliente recebeu a resposta genérica — verifique o claude_cli/credenciais.`
}

/**
 * Mensagem do alarme de handoff SENSÍVEL (pura). Sem conteúdo da conversa — PII não
 * sai do banco; o operador abre a Central pra ver.
 */
export function formatSensitiveAlarm(tenantSlug: string, suppressed: number): string {
  const extra = suppressed > 0 ? ` (+${suppressed} escalação(ões) no intervalo)` : ''
  return `🚨 [ALARM] Escalação SENSÍVEL no tenant ${tenantSlug}${extra} — pode ser emergência de saúde. Abra a Central (/atendente) agora.`
}

// Estado do throttle no processo (single-instance no Pi). Cada reinício zera.
let state: AlarmState = { lastSentAt: null, suppressed: 0 }

// Throttle PRÓPRIO do alarme sensível (não divide cooldown com degradação: um
// não pode silenciar o outro) e mais curto — emergência não espera 10 min.
const DEFAULT_SENSITIVE_COOLDOWN_MS = 2 * 60 * 1000
let sensitiveState: AlarmState = { lastSentAt: null, suppressed: 0 }

function sensitiveCooldownMs(): number {
  const raw = Number(process.env.ALARM_SENSITIVE_COOLDOWN_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SENSITIVE_COOLDOWN_MS
}

/**
 * Reporta um handoff sensível (ex.: gatilho de saúde no csmed). Mesmo contrato do
 * reportDegradation: sempre loga, POST best-effort se ALARM_WEBHOOK_URL existir,
 * nunca lança. Prioridade máxima no ntfy (fura o silencioso do celular).
 */
export async function reportSensitiveHandoff(tenantSlug: string): Promise<void> {
  try {
    const decision = decideAlarm(Date.now(), sensitiveState, sensitiveCooldownMs())
    sensitiveState = decision.state
    if (!decision.send) {
      return
    }
    const message = formatSensitiveAlarm(tenantSlug, decision.suppressed)
    console.error(message)

    const url = process.env.ALARM_WEBHOOK_URL
    if (url) {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', Title: 'Escalação sensível', Priority: 'urgent' },
        body: message,
      }).catch(() => {})
    }
  } catch {
    // engole tudo: alarme é secundário ao atendimento
  }
}

/**
 * Reporta uma degradação do motor. SEMPRE loga um `[ALARM]` (visível no hermes.log)
 * e, se `ALARM_WEBHOOK_URL` estiver definido, faz um POST best-effort com o texto puro
 * (funciona direto com ntfy.sh → push no celular sem conta). Nunca lança — o
 * atendimento não pode quebrar por causa do alarme.
 */
export async function reportDegradation(reason: string): Promise<void> {
  try {
    const decision = decideAlarm(Date.now(), state)
    state = decision.state
    if (!decision.send) {
      return
    }
    const message = formatAlarm(reason, decision.suppressed)
    console.error(message)

    const url = process.env.ALARM_WEBHOOK_URL
    if (url) {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', Title: 'Hermes degradou', Priority: 'high' },
        body: message,
      }).catch(() => {})
    }
  } catch {
    // engole tudo: alarme é secundário ao atendimento
  }
}

/** Só para teste: reseta os throttles do processo. */
export function __resetAlarmState(): void {
  state = { lastSentAt: null, suppressed: 0 }
  sensitiveState = { lastSentAt: null, suppressed: 0 }
}
