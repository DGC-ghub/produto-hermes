import { describe, expect, it } from 'vitest'
import { formatDate } from './format'

describe('formatDate', () => {
  it('returns YYYY-MM-DD for a given date', () => {
    const d = new Date('2024-03-15T12:00:00.000Z')
    expect(formatDate(d)).toBe('2024-03-15')
  })

  it('pads single-digit months and days', () => {
    const d = new Date('2024-01-05T00:00:00.000Z')
    expect(formatDate(d)).toBe('2024-01-05')
  })
})
