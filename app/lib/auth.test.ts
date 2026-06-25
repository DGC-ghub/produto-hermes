import { describe, expect, it } from 'vitest'
import { safeRedirect } from './auth.server'

describe('safeRedirect', () => {
  it('allows internal absolute paths', () => {
    expect(safeRedirect('/dashboard')).toBe('/dashboard')
    expect(safeRedirect('/atendente?contactId=x')).toBe('/atendente?contactId=x')
  })

  it('falls back when missing', () => {
    expect(safeRedirect(null)).toBe('/atendente')
    expect(safeRedirect(undefined)).toBe('/atendente')
    expect(safeRedirect('')).toBe('/atendente')
  })

  it('blocks protocol-relative open redirects', () => {
    expect(safeRedirect('//evil.com')).toBe('/atendente')
  })

  it('blocks absolute URLs to other origins', () => {
    expect(safeRedirect('https://evil.com')).toBe('/atendente')
    expect(safeRedirect('http://evil.com')).toBe('/atendente')
  })

  it('respects a custom fallback', () => {
    expect(safeRedirect(null, '/dashboard')).toBe('/dashboard')
  })
})
