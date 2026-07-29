import { describe, expect, it } from 'vitest'
import { authorizeMetrics, extractToken, parseWindowMinutes } from './metrics-auth'

function req(init: { headers?: Record<string, string>; url?: string } = {}): Request {
  return new Request(init.url ?? 'https://hermes.exemplo/metrics', { headers: init.headers })
}

describe('extractToken', () => {
  it('lê do header Authorization: Bearer', () => {
    expect(extractToken(req({ headers: { authorization: 'Bearer segredo' } }))).toBe('segredo')
  })

  it('lê da query string', () => {
    expect(extractToken(req({ url: 'https://h/metrics?token=segredo' }))).toBe('segredo')
  })

  it('prefere o header quando os dois vêm', () => {
    const r = req({
      url: 'https://h/metrics?token=daquery',
      headers: { authorization: 'Bearer doheader' },
    })
    expect(extractToken(r)).toBe('doheader')
  })

  it('devolve null sem token', () => {
    expect(extractToken(req())).toBeNull()
    expect(extractToken(req({ url: 'https://h/metrics?token=' }))).toBeNull()
  })
})

describe('authorizeMetrics', () => {
  it('libera com o token certo', () => {
    expect(authorizeMetrics(req({ headers: { authorization: 'Bearer certo' } }), 'certo')).toEqual({
      ok: true,
    })
  })

  it('FALHA FECHADO quando METRICS_TOKEN não está configurado (404, mesmo com token na mão)', () => {
    // Regressão do jeito errado de fazer: sem env, liberar geral. O Hermes fica
    // exposto na internet pelo funnel — esquecer de configurar não pode abrir a porta.
    expect(
      authorizeMetrics(req({ headers: { authorization: 'Bearer qualquer' } }), undefined),
    ).toEqual({ ok: false, status: 404, reason: 'nao_configurado' })
    expect(authorizeMetrics(req(), '')).toEqual({
      ok: false,
      status: 404,
      reason: 'nao_configurado',
    })
  })

  it('recusa token errado, ausente ou de tamanho diferente', () => {
    expect(authorizeMetrics(req({ headers: { authorization: 'Bearer errado' } }), 'certo')).toEqual(
      {
        ok: false,
        status: 401,
        reason: 'token_invalido',
      },
    )
    expect(authorizeMetrics(req(), 'certo').ok).toBe(false)
    // prefixo correto não passa: comparação é do valor inteiro
    expect(authorizeMetrics(req({ headers: { authorization: 'Bearer cert' } }), 'certo').ok).toBe(
      false,
    )
  })
})

describe('parseWindowMinutes', () => {
  it('usa o valor pedido', () => {
    expect(parseWindowMinutes('120')).toBe(120)
  })

  it('cai no padrão para lixo, zero ou negativo', () => {
    expect(parseWindowMinutes(null)).toBe(60)
    expect(parseWindowMinutes('abc')).toBe(60)
    expect(parseWindowMinutes('0')).toBe(60)
    expect(parseWindowMinutes('-5')).toBe(60)
  })

  it('limita a 7 dias para não varrer o banco', () => {
    expect(parseWindowMinutes('999999')).toBe(7 * 24 * 60)
  })
})
