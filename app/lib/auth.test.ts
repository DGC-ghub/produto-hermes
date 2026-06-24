import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkOperatorPassword, safeRedirect } from './auth.server'

describe('checkOperatorPassword', () => {
  const original = process.env.OPERATOR_PASSWORD
  beforeEach(() => {
    process.env.OPERATOR_PASSWORD = 'segredo-do-operador'
  })
  afterEach(() => {
    process.env.OPERATOR_PASSWORD = original
  })

  it('accepts the exact configured password', () => {
    expect(checkOperatorPassword('segredo-do-operador')).toBe(true)
  })

  it('rejects a wrong password', () => {
    expect(checkOperatorPassword('errado')).toBe(false)
  })

  it('rejects a wrong-length password without throwing', () => {
    expect(checkOperatorPassword('x')).toBe(false)
  })

  it('is fail-closed when no password is configured', () => {
    process.env.OPERATOR_PASSWORD = ''
    expect(checkOperatorPassword('qualquer')).toBe(false)
    process.env.OPERATOR_PASSWORD = undefined
    expect(checkOperatorPassword('qualquer')).toBe(false)
  })
})

describe('safeRedirect', () => {
  it('allows internal absolute paths', () => {
    expect(safeRedirect('/dashboard')).toBe('/dashboard')
    expect(safeRedirect('/atendente?tenant=dgc&contactId=x')).toBe(
      '/atendente?tenant=dgc&contactId=x',
    )
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
