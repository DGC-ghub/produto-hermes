import { describe, expect, it, vi } from 'vitest'
import { criarEmissorAsaas, lerConfigAsaas, urlEhSandbox } from './asaas'
import { tratarWebhookAsaas } from './asaas-webhook'
import { criarEmissorFalso } from './fake'
import {
  type CobrancaRegistro,
  type CobrancaStore,
  type FluxoDeps,
  iniciarCobranca,
  processarEvento,
} from './fluxo'
import { motivoRejeicaoParaRecepcao } from './mensagens'
import { buscarServico, SERVICOS_EXEMPLO } from './servicos'
import { tokenConfere } from './token'

function montar() {
  const registros: (CobrancaRegistro & { pdfUrl?: string; motivo?: string })[] = []
  const store: CobrancaStore = {
    async criar(d) {
      const r = {
        ...d,
        id: `c${registros.length + 1}`,
        notaId: null,
        status: 'aguardando_pagamento' as const,
      }
      registros.push(r)
      return r
    },
    async buscarPorPagamento(p) {
      return registros.find((r) => r.paymentId === p) ?? null
    },
    async buscarPorNota(n) {
      return registros.find((r) => r.notaId === n) ?? null
    },
    async marcarEmEmissao(id) {
      const r = registros.find((x) => x.id === id)
      if (!r || r.status !== 'aguardando_pagamento') {
        return false
      }
      r.status = 'nota_em_emissao'
      return true
    },
    async atualizar(id, patch) {
      Object.assign(registros.find((r) => r.id === id) ?? {}, patch)
    },
  }
  const paciente: string[] = []
  const recepcao: { texto: string; humano?: boolean }[] = []
  const emissor = criarEmissorFalso()
  const emitir = vi.spyOn(emissor, 'emitirNota')
  const deps: FluxoDeps = {
    emissor,
    store,
    log: vi.fn(),
    notificador: {
      async paraPaciente(_c, t) {
        paciente.push(t)
      },
      async paraRecepcao(_c, t, o) {
        recepcao.push({ texto: t, humano: o?.chamarHumano })
      },
    },
  }
  return { deps, registros, paciente, recepcao, emitir }
}

describe('fluxo Pix → nota → PDF', () => {
  it('caminho feliz: Pix, pagamento, nota autorizada e PDF/XML ao paciente', async () => {
    const { deps, registros, paciente, recepcao } = montar()
    const c = await iniciarCobranca(
      { conversationId: 'conv1', servicoChave: 'consulta_odonto', valorCentavos: 15000 },
      deps,
    )
    expect(paciente[0]).toContain('Pix')
    expect(paciente[0]).toContain('R$')

    await processarEvento({ tipo: 'pagamento_recebido', cobrancaId: c.paymentId }, deps)
    expect(registros[0].status).toBe('nota_em_emissao')
    const notaId = registros[0].notaId as string
    expect(notaId).toBeTruthy()

    await processarEvento(
      { tipo: 'nota_autorizada', notaId, pdfUrl: 'https://x/p.pdf', xmlUrl: 'https://x/n.xml' },
      deps,
    )
    expect(registros[0].status).toBe('nota_autorizada')
    expect(paciente[1]).toContain('https://x/p.pdf')
    expect(paciente[1]).toContain('https://x/n.xml')
    expect(recepcao).toHaveLength(0)
  })

  it('webhook repetido não emite duas notas', async () => {
    const { deps, emitir } = montar()
    const c = await iniciarCobranca(
      { conversationId: 'conv1', servicoChave: 'consulta_odonto', valorCentavos: 100 },
      deps,
    )
    const ev = { tipo: 'pagamento_recebido', cobrancaId: c.paymentId } as const
    await processarEvento(ev, deps)
    await processarEvento(ev, deps)
    expect(emitir).toHaveBeenCalledTimes(1)
  })

  it('rejeição: recepção recebe o motivo e a conversa vai para humano; paciente não recebe nota', async () => {
    const { deps, paciente, recepcao, registros } = montar()
    const c = await iniciarCobranca(
      { conversationId: 'conv1', servicoChave: 'consulta_odonto', valorCentavos: 100 },
      deps,
    )
    await processarEvento({ tipo: 'pagamento_recebido', cobrancaId: c.paymentId }, deps)
    await processarEvento(
      {
        tipo: 'nota_rejeitada',
        notaId: registros[0].notaId as string,
        motivoBruto: 'Item de serviço inválido',
        payloadBruto: {},
      },
      deps,
    )
    expect(registros[0].status).toBe('nota_rejeitada')
    expect(recepcao[0].texto).toContain('Item de serviço inválido')
    expect(recepcao[0].humano).toBe(true)
    expect(paciente).toHaveLength(1) // só o Pix
  })

  it('rejeição sem motivo: mensagem padrão e payload bruto no log', async () => {
    const { deps, recepcao, registros } = montar()
    const c = await iniciarCobranca(
      { conversationId: 'conv1', servicoChave: 'consulta_odonto', valorCentavos: 100 },
      deps,
    )
    await processarEvento({ tipo: 'pagamento_recebido', cobrancaId: c.paymentId }, deps)
    const bruto = { event: 'INVOICE_ERROR' }
    await processarEvento(
      {
        tipo: 'nota_rejeitada',
        notaId: registros[0].notaId as string,
        motivoBruto: '',
        payloadBruto: bruto,
      },
      deps,
    )
    expect(recepcao[0].texto).toContain(
      'prefeitura recusou a nota; confira os dados com o contador',
    )
    expect(deps.log).toHaveBeenCalledWith(expect.any(String), bruto)
  })

  it('rejeita valor inválido e serviço desconhecido', async () => {
    const { deps } = montar()
    await expect(
      iniciarCobranca(
        { conversationId: 'c', servicoChave: 'consulta_odonto', valorCentavos: 0 },
        deps,
      ),
    ).rejects.toThrow()
    await expect(
      iniciarCobranca({ conversationId: 'c', servicoChave: 'x', valorCentavos: 100 }, deps),
    ).rejects.toThrow()
  })

  it('falha ao pedir a nota avisa a recepção', async () => {
    const { deps, recepcao, registros } = montar()
    const c = await iniciarCobranca(
      { conversationId: 'conv1', servicoChave: 'consulta_odonto', valorCentavos: 100 },
      deps,
    )
    vi.spyOn(deps.emissor, 'emitirNota').mockRejectedValue(new Error('boom'))
    await processarEvento({ tipo: 'pagamento_recebido', cobrancaId: c.paymentId }, deps)
    expect(registros[0].status).toBe('erro')
    expect(recepcao).toHaveLength(1)
  })
})

describe('webhook do Asaas (payloads de exemplo)', () => {
  it('PAYMENT_RECEIVED', () => {
    expect(tratarWebhookAsaas({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } })).toEqual({
      tipo: 'pagamento_recebido',
      cobrancaId: 'pay_1',
    })
  })
  it('INVOICE_AUTHORIZED', () => {
    expect(
      tratarWebhookAsaas({
        event: 'INVOICE_AUTHORIZED',
        invoice: { id: 'inv_1', pdfUrl: 'p', xmlUrl: 'x' },
      }),
    ).toEqual({ tipo: 'nota_autorizada', notaId: 'inv_1', pdfUrl: 'p', xmlUrl: 'x' })
  })
  it('INVOICE_ERROR com e sem statusDescription', () => {
    const a = tratarWebhookAsaas({
      event: 'INVOICE_ERROR',
      invoice: { id: 'inv_1', statusDescription: 'Erro X' },
    })
    expect(a).toMatchObject({ tipo: 'nota_rejeitada', motivoBruto: 'Erro X' })
    const b = tratarWebhookAsaas({ event: 'INVOICE_ERROR', invoice: { id: 'inv_1' } })
    expect(b).toMatchObject({ tipo: 'nota_rejeitada', motivoBruto: null })
  })
  it('ignora evento desconhecido e lixo', () => {
    expect(tratarWebhookAsaas({ event: 'PAYMENT_CREATED', payment: { id: 'p' } })).toBeNull()
    expect(tratarWebhookAsaas(null)).toBeNull()
    expect(tratarWebhookAsaas('x')).toBeNull()
    expect(tratarWebhookAsaas({ event: 'INVOICE_AUTHORIZED', invoice: { id: 'i' } })).toBeNull()
  })
})

describe('mensagens e tabela de serviços', () => {
  it('motivo vazio, longo e normal', () => {
    expect(motivoRejeicaoParaRecepcao(undefined)).toContain('confira os dados com o contador')
    expect(motivoRejeicaoParaRecepcao('  ')).toContain('confira os dados com o contador')
    expect(motivoRejeicaoParaRecepcao('a'.repeat(500)).length).toBeLessThan(400)
    expect(motivoRejeicaoParaRecepcao('Erro\n  X')).toContain('Erro X')
  })
  it('descrição da nota é genérica e a tabela é marcada como exemplo', () => {
    for (const s of SERVICOS_EXEMPLO) {
      expect(s.exemplo).toBe(true)
      expect(s.descricaoNota.length).toBeLessThan(40)
    }
    expect(buscarServico('consulta_odonto')?.descricaoNota).toBe('Serviço odontológico')
    expect(buscarServico('nada')).toBeNull()
  })
})

describe('cliente Asaas', () => {
  it('sem chave ou URL, não configura', () => {
    expect(lerConfigAsaas({})).toBeNull()
    expect(lerConfigAsaas({ ASAAS_API_KEY: 'k', ASAAS_BASE_URL: '' })).toBeNull()
  })
  it('recusa URL que não seja sandbox', () => {
    expect(() => criarEmissorAsaas({ apiKey: 'k', baseUrl: 'https://api.exemplo.com/v3' })).toThrow(
      /sandbox/,
    )
  })
  it('cria Pix e nota com a sequência certa de chamadas', async () => {
    const chamadas: string[] = []
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      chamadas.push(`${init?.method} ${u.replace('https://api-sandbox.asaas.com/v3', '')}`)
      const corpo = u.endsWith('/customers')
        ? { id: 'cus_1' }
        : u.endsWith('/payments')
          ? { id: 'pay_1' }
          : u.includes('pixQrCode')
            ? { payload: 'PIX123' }
            : { id: 'inv_1' }
      return new Response(JSON.stringify(corpo), { status: 200 })
    }) as unknown as typeof fetch
    const e = criarEmissorAsaas({
      apiKey: 'k',
      baseUrl: 'https://api-sandbox.asaas.com/v3',
      fetchFn,
    })
    expect(
      await e.criarCobrancaPix({ referencia: 'r', valorCentavos: 1000, descricao: 'd' }),
    ).toEqual({ id: 'pay_1', pixCopiaECola: 'PIX123' })
    const servico = buscarServico('consulta_odonto')
    if (!servico) throw new Error('serviço')
    expect(
      await e.emitirNota({ cobrancaId: 'pay_1', referencia: 'r', valorCentavos: 1000, servico }),
    ).toEqual({ notaId: 'inv_1' })
    expect(chamadas).toEqual([
      'POST /customers',
      'POST /payments',
      'GET /payments/pay_1/pixQrCode',
      'POST /invoices',
    ])
  })
  it('erro HTTP não vaza o corpo', async () => {
    const fetchFn = (async () =>
      new Response('{"segredo":"x"}', { status: 401 })) as unknown as typeof fetch
    const e = criarEmissorAsaas({
      apiKey: 'k',
      baseUrl: 'https://api-sandbox.asaas.com/v3',
      fetchFn,
    })
    await expect(
      e.criarCobrancaPix({ referencia: 'r', valorCentavos: 1, descricao: 'd' }),
    ).rejects.toThrow(/401/)
  })
})

describe('concorrência e travas', () => {
  it('dois webhooks simultâneos com store que devolve cópia emitem 1 nota', async () => {
    const { deps, emitir } = montar()
    const base = deps.store
    // Como o Prisma: leituras devolvem cópia, a transição atômica é a única que decide.
    deps.store = {
      ...base,
      async buscarPorPagamento(p) {
        const r = await base.buscarPorPagamento(p)
        const copia = r ? { ...r } : null
        await new Promise((ok) => setTimeout(ok, 5))
        return copia
      },
    }
    const c = await iniciarCobranca(
      { conversationId: 'conv1', servicoChave: 'consulta_odonto', valorCentavos: 100 },
      deps,
    )
    const ev = { tipo: 'pagamento_recebido', cobrancaId: c.paymentId } as const
    await Promise.all([processarEvento(ev, deps), processarEvento(ev, deps)])
    expect(emitir).toHaveBeenCalledTimes(1)
  })

  it('token do webhook: env vazio, sem cabeçalho, errado, tamanho diferente e certo', () => {
    expect(tokenConfere('abc', undefined)).toBe(false)
    expect(tokenConfere('abc', '')).toBe(false)
    expect(tokenConfere(null, 'abc')).toBe(false)
    expect(tokenConfere('abd', 'abc')).toBe(false)
    expect(tokenConfere('abcd', 'abc')).toBe(false)
    expect(tokenConfere('abc', 'abc')).toBe(true)
  })

  it('trava de sandbox: host exato, só https', () => {
    expect(urlEhSandbox('https://api-sandbox.asaas.com/v3')).toBe(true)
    expect(urlEhSandbox('https://api.asaas.com/v3?sandbox')).toBe(false)
    expect(urlEhSandbox('https://api.asaas.com/v3#sandbox')).toBe(false)
    expect(urlEhSandbox('https://sandbox.qualquer.com')).toBe(false)
    expect(urlEhSandbox('http://api-sandbox.asaas.com/v3')).toBe(false)
    expect(urlEhSandbox('nao é url')).toBe(false)
  })
})
