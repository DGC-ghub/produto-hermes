// Chama o loader direto (sem subir servidor). O que importa provar aqui é que a sonda
// distingue "banco responde" de "banco não responde" — um /health que devolve 200 com o
// banco travado é pior que não ter monitor, porque cala o alarme.

import { describe, expect, it, vi } from 'vitest'

describe('GET /health', () => {
  it('responde 200 com status ok quando o banco responde', async () => {
    const { loader } = await import('./health')
    const response = await loader()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('responde 503 quando o banco não responde', async () => {
    vi.resetModules()
    vi.doMock('../db.server', () => ({
      db: {
        $queryRaw: () => Promise.reject(new Error('SQLITE_BUSY: database is locked')),
      },
    }))

    const { loader } = await import('./health')
    const response = await loader()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'degraded' })

    vi.doUnmock('../db.server')
    vi.resetModules()
  })

  it('não vaza detalhe do erro na resposta pública', async () => {
    vi.resetModules()
    vi.doMock('../db.server', () => ({
      db: {
        $queryRaw: () => Promise.reject(new Error('file:/home/pi/projects/produto-hermes/dev.db')),
      },
    }))

    const { loader } = await import('./health')
    const corpo = await (await loader()).text()

    // Caminho de arquivo, nome de tabela e stack não podem chegar a quem bate na rota.
    expect(corpo).toBe('{"status":"degraded"}')

    vi.doUnmock('../db.server')
    vi.resetModules()
  })
})
