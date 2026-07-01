// Limite de taxa GLOBAL para o webhook público. Atrás da ponte do Tailscale o app
// vê tudo como localhost, então limitar por IP não serve — usamos um teto de
// requisições por janela, rejeitando o excesso barato (429) antes de tocar
// assinatura/motor. Protege contra flood e contra o Pi engasgar num pico de spawns.

const DEFAULT_MAX = 120 // req por janela
const DEFAULT_WINDOW_MS = 60_000 // 1 min

/** Config vinda do ambiente, com defaults generosos (uso de piloto é bem menor). */
export function rateConfig(): { max: number; windowMs: number } {
  const max = Number(process.env.RATE_LIMIT_MAX)
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS)
  return {
    max: Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS,
  }
}

export type RateState = { windowStart: number; count: number }
export type RateResult = { allowed: boolean; state: RateState; retryAfterSec: number }

/**
 * Janela fixa: pura e testável. Zera a contagem quando a janela expira; enquanto
 * dentro dela, conta até `max`. Estourou → nega e diz em quantos segundos tentar de novo.
 */
export function checkRate(
  now: number,
  state: RateState,
  max: number,
  windowMs: number,
): RateResult {
  if (now - state.windowStart >= windowMs) {
    return { allowed: true, state: { windowStart: now, count: 1 }, retryAfterSec: 0 }
  }
  if (state.count < max) {
    return {
      allowed: true,
      state: { windowStart: state.windowStart, count: state.count + 1 },
      retryAfterSec: 0,
    }
  }
  const retryAfterSec = Math.ceil((windowMs - (now - state.windowStart)) / 1000)
  return { allowed: false, state, retryAfterSec }
}
