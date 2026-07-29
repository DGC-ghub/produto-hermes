import { afterEach, describe, expect, it, vi } from 'vitest'
import { isUsableAppUrl, pickAppUrl } from './app-url.server'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isUsableAppUrl', () => {
  it('aceita http e https com host', () => {
    expect(isUsableAppUrl('https://hermesatende.com.br')).toBe(true)
    expect(isUsableAppUrl('http://localhost:5173')).toBe(true)
  })

  it('recusa o erro mais provável: domínio digitado sem o esquema', () => {
    expect(isUsableAppUrl('hermesatende.com.br')).toBe(false)
  })

  it('recusa vazio e esquema que não serve para link de e-mail', () => {
    expect(isUsableAppUrl('')).toBe(false)
    expect(isUsableAppUrl('ftp://exemplo.com.br')).toBe(false)
  })
})

describe('pickAppUrl', () => {
  it('o que foi configurado tem precedência sobre o host da requisição', () => {
    // É o caso de produção: o proxy entrega a conexão como localhost, mas o link
    // do e-mail precisa apontar para o domínio que o cliente consegue abrir.
    expect(pickAppUrl('https://hermesatende.com.br', 'https://localhost:5173')).toBe(
      'https://hermesatende.com.br',
    )
  })

  it('sem configuração, usa o endereço da requisição (dev)', () => {
    expect(pickAppUrl(undefined, 'http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('tira a barra final para o link não sair com barra dupla', () => {
    expect(pickAppUrl('https://hermesatende.com.br/', 'https://x')).toBe(
      'https://hermesatende.com.br',
    )
  })

  it('configuração inválida não derruba o envio: avisa e cai para a requisição', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(pickAppUrl('hermesatende.com.br', 'https://localhost:5173')).toBe(
      'https://localhost:5173',
    )
    expect(erro).toHaveBeenCalledOnce()
    expect(erro.mock.calls[0]?.[0]).toContain('APP_URL inválida')
  })
})
