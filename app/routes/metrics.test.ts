// Testa o endpoint chamando o loader direto (sem subir servidor). O foco é o
// portão: métricas não podem vazar de um app exposto na internet pelo funnel.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { loader } from './metrics'

const TOKEN = 'token-de-teste-1234'

function chamar(url: string, headers: Record<string, string> = {}) {
  // O loader só usa `request`; o resto do contrato do React Router não entra aqui.
  return loader({ request: new Request(url, { headers }) } as Parameters<typeof loader>[0])
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /metrics', () => {
  it('responde 404 quando METRICS_TOKEN não está configurado', async () => {
    vi.stubEnv('METRICS_TOKEN', '')
    await expect(chamar('https://h/metrics')).rejects.toMatchObject({ status: 404 })
  })

  it('responde 401 com token errado', async () => {
    vi.stubEnv('METRICS_TOKEN', TOKEN)
    await expect(
      chamar('https://h/metrics', { authorization: 'Bearer errado' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('devolve exposition format do Prometheus com o token certo', async () => {
    vi.stubEnv('METRICS_TOKEN', TOKEN)
    const response = await chamar('https://h/metrics', { authorization: `Bearer ${TOKEN}` })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/plain')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toContain('# TYPE hermes_message_duration_ms gauge')
  })

  it('devolve o relatório legível com ?formato=texto', async () => {
    vi.stubEnv('METRICS_TOKEN', TOKEN)
    const response = await chamar('https://h/metrics?formato=texto&tenant=nao-existe&minutos=30', {
      authorization: `Bearer ${TOKEN}`,
    })
    expect(await response.text()).toBe('Sem mensagens nos últimos 30 min.')
  })
})
