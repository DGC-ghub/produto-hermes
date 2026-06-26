// Série de atividade por dia, para o sparkline do painel. Função pura (sem db),
// para os testes rodarem no ambiente `node` do Vitest.

export type DayBucket = { day: string; count: number }

/**
 * Distribui timestamps em buckets diários dos últimos `days` dias (incluindo hoje),
 * preenchendo os dias sem atividade com 0 — assim o sparkline tem largura fixa e
 * não "pula" dias vazios. `now` é injetado para tornar o teste determinístico.
 */
export function buildDailyActivity(timestamps: Date[], days: number, now: Date): DayBucket[] {
  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const counts = new Map<string, number>()
  for (const t of timestamps) {
    const key = dayKey(t)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const buckets: DayBucket[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    const key = dayKey(d)
    buckets.push({ day: key, count: counts.get(key) ?? 0 })
  }
  return buckets
}
