import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/auth.server', () => ({
  requireOperator: vi.fn(async () => ({
    tenantId: 't1',
    tenantSlug: 'clinica-demo',
    username: 'dono',
  })),
}))
vi.mock('../db.server', () => ({
  db: { tenant: { findUnique: vi.fn(async () => ({ name: 'Clínica Aurora (demo)' })) } },
}))
const enviar = vi.hoisted(() => vi.fn(async () => ({ enviadas: 2, falhas: 1 })))
vi.mock('../lib/agenda/confirmacoes.server', () => ({ enviarConfirmacoesDeAmanha: enviar }))

const { action } = await import('./atendente')

describe('action "confirmacoes"', () => {
  it('usa o tenant da sessão e volta com o resultado', async () => {
    const body = new FormData()
    body.append('intent', 'confirmacoes')
    const res = (await action({
      request: new Request('https://h/atendente', { method: 'POST', body }),
    } as Parameters<typeof action>[0])) as Response
    expect(enviar).toHaveBeenCalledWith({
      tenantId: 't1',
      tenantSlug: 'clinica-demo',
      tenantName: 'Clínica Aurora (demo)',
    })
    expect(res.headers.get('Location')).toBe('/atendente?confirmacoes=2&falhas=1')
  })
})
