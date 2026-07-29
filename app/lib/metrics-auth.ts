// Autorização do endpoint /metrics — pura e testável, separada da rota.
//
// Por que existe: o Hermes fica exposto na internet pelo funnel do Tailscale.
// Métricas não têm PII, mas entregam de graça o mapa operacional do negócio
// (volume por cliente, quando o motor cai, quanto tráfego existe). Fica atrás de
// um token — e sem token configurado o endpoint simplesmente NÃO existe, para
// que esquecer de configurar falhe fechado, nunca aberto.

import { timingSafeEqual } from 'node:crypto'

export type MetricsAuth =
  | { ok: true }
  | { ok: false; status: 404 | 401; reason: 'nao_configurado' | 'token_invalido' }

/** Compara em tempo constante (o tamanho pode vazar; o conteúdo, não). */
function sameSecret(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/**
 * Extrai o token de `Authorization: Bearer <t>` ou de `?token=<t>`. O header é o
 * caminho preferido (o Prometheus manda header, e query string vaza em log de
 * proxy); a query fica para um `curl` rápido no terminal.
 */
export function extractToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim()
  }
  const fromQuery = new URL(request.url).searchParams.get('token')
  return fromQuery && fromQuery.length > 0 ? fromQuery : null
}

/**
 * Decide se a requisição pode ler as métricas. Sem `METRICS_TOKEN` no ambiente,
 * responde 404 — não confirma nem nega que a rota exista.
 */
export function authorizeMetrics(request: Request, expected: string | undefined): MetricsAuth {
  if (!expected || expected.length === 0) {
    return { ok: false, status: 404, reason: 'nao_configurado' }
  }
  const provided = extractToken(request)
  if (!provided || !sameSecret(expected, provided)) {
    return { ok: false, status: 401, reason: 'token_invalido' }
  }
  return { ok: true }
}

/** Janela pedida, em minutos. Limitada a 7 dias para não varrer o banco à toa. */
export function parseWindowMinutes(raw: string | null, fallback = 60): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.min(Math.floor(parsed), 7 * 24 * 60)
}
