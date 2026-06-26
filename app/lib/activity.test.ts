import { describe, expect, it } from 'vitest'
import { buildDailyActivity } from './activity'

const NOW = new Date('2026-06-26T15:00:00.000Z')

describe('buildDailyActivity', () => {
  it('produz um bucket por dia, com largura fixa', () => {
    const series = buildDailyActivity([], 14, NOW)
    expect(series).toHaveLength(14)
    expect(series.every((b) => b.count === 0)).toBe(true)
  })

  it('termina no dia de hoje e começa days-1 atrás', () => {
    const series = buildDailyActivity([], 7, NOW)
    expect(series[0].day).toBe('2026-06-20')
    expect(series.at(-1)?.day).toBe('2026-06-26')
  })

  it('conta os timestamps no dia certo e ignora os fora da janela', () => {
    const ts = [
      new Date('2026-06-26T09:00:00Z'),
      new Date('2026-06-26T20:00:00Z'),
      new Date('2026-06-24T12:00:00Z'),
      new Date('2026-06-01T12:00:00Z'), // fora dos últimos 7 dias
    ]
    const series = buildDailyActivity(ts, 7, NOW)
    const byDay = Object.fromEntries(series.map((b) => [b.day, b.count]))
    expect(byDay['2026-06-26']).toBe(2)
    expect(byDay['2026-06-24']).toBe(1)
    expect(series.reduce((s, b) => s + b.count, 0)).toBe(3) // o de 01/06 ficou de fora
  })
})
