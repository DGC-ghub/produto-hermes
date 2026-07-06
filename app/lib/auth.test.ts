import { describe, expect, it } from 'vitest'
import type { AuthedAccount } from './accounts.server'
import { createOperatorSession, getOperator, requireOwner, safeRedirect } from './auth.server'

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

const OWNER: AuthedAccount = {
  accountId: 'a1',
  email: 'dono@x.local',
  role: 'owner',
  tenantId: 't1',
  tenantSlug: 'acme',
}
const OPERATOR: AuthedAccount = {
  ...OWNER,
  accountId: 'a2',
  email: 'atend@x.local',
  role: 'operator',
}

async function requestWithSessionFor(account: AuthedAccount): Promise<Request> {
  const res = await createOperatorSession(account, '/x')
  const setCookie = res.headers.get('Set-Cookie') ?? ''
  return new Request('http://localhost/config', { headers: { Cookie: setCookie.split(';')[0] } })
}

describe('sessão (round-trip) + requireOwner', () => {
  it('createOperatorSession → getOperator preserva accountId, role, e-mail e tenant', async () => {
    const session = await getOperator(await requestWithSessionFor(OWNER))
    expect(session?.accountId).toBe('a1')
    expect(session?.role).toBe('owner')
    expect(session?.username).toBe('dono@x.local') // o e-mail vira o username de exibição
    expect(session?.tenantSlug).toBe('acme')
  })

  it('requireOwner deixa o owner passar', async () => {
    const session = await requireOwner(await requestWithSessionFor(OWNER))
    expect(session.role).toBe('owner')
  })

  it('requireOwner manda o operator de volta pra /atendente', async () => {
    let redirected = false
    try {
      await requireOwner(await requestWithSessionFor(OPERATOR))
    } catch (thrown) {
      redirected = true
      expect(thrown).toBeInstanceOf(Response)
      expect((thrown as Response).status).toBe(302)
      expect((thrown as Response).headers.get('Location')).toBe('/atendente')
    }
    expect(redirected).toBe(true)
  })
})
