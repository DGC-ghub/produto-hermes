import { describe, expect, it } from 'vitest'
import { checkRate, type RateState } from './rate-limit'

const MAX = 3
const WINDOW = 60_000
const start: RateState = { windowStart: 0, count: 0 }

describe('checkRate', () => {
  it('abre uma janela nova quando a anterior já expirou (caso real)', () => {
    // now >> windowMs (como um epoch de verdade) → estado inicial expira e abre janela em `now`.
    const now = WINDOW + 1000
    const r = checkRate(now, start, MAX, WINDOW)
    expect(r.allowed).toBe(true)
    expect(r.state).toEqual({ windowStart: now, count: 1 })
  })

  it('permite até o teto e bloqueia o excesso na mesma janela', () => {
    let s = checkRate(1000, start, MAX, WINDOW).state // count 1
    s = checkRate(1100, s, MAX, WINDOW).state // 2
    const third = checkRate(1200, s, MAX, WINDOW) // 3 (ainda passa)
    expect(third.allowed).toBe(true)
    const fourth = checkRate(1300, third.state, MAX, WINDOW) // estoura
    expect(fourth.allowed).toBe(false)
    expect(fourth.retryAfterSec).toBeGreaterThan(0)
    expect(fourth.state.count).toBe(3) // não incrementa quando nega
  })

  it('libera de novo quando a janela expira', () => {
    let s = start
    for (let i = 0; i < MAX; i++) {
      s = checkRate(1000 + i, s, MAX, WINDOW).state
    }
    expect(checkRate(1000 + MAX, s, MAX, WINDOW).allowed).toBe(false) // dentro da janela
    const later = checkRate(1000 + WINDOW, s, MAX, WINDOW) // janela expirou
    expect(later.allowed).toBe(true)
    expect(later.state.count).toBe(1)
  })
})
