import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttendantInput } from '../types'
import { anthropicApiProvider } from './anthropic-api.server'

const input: AttendantInput = {
  tenant: { slug: 'assistencia-tecnica-demo', name: 'ResolveTech' },
  companyRules: ['não prometa preço fechado'],
  enabledTools: ['abrir_chamado'],
  knowledge: [{ title: 'Bairros', snippet: 'Atendemos Centro e Jardim América' }],
  history: [{ role: 'user', content: 'oi' }],
  lead: { name: null, phone: null, neighborhood: 'Centro', need: null, urgency: null },
  myTickets: [],
  message: 'minha geladeira parou',
}

const goodJson =
  '{"reply":"ok","needsHuman":false,"handoffReason":null,"leadPatch":null,"confidence":0.8,"action":null}'

// Guarda o env original: setar ANTHROPIC_API_KEY num teste não pode vazar para o
// próximo arquivo do mesmo worker (bug clássico do vitest, já mordeu antes).
const ORIGINAL_ENV = { ...process.env }

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('anthropicApiProvider', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    // Silencia os logs esperados de erro para não poluir a saída dos testes.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    process.env = { ...ORIGINAL_ENV }
  })

  it('monta a requisição certa e devolve o JSON parseado', async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: goodJson }], stop_reason: 'end_turn' }),
    })

    const output = await anthropicApiProvider.generate(input)
    expect(output.reply).toBe('ok')
    expect(output.confidence).toBe(0.8)

    // Uma chamada, para a API de mensagens, com a chave e a versão nos headers.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')

    // O corpo carrega o MESMO prompt do buildPrompt (mensagem do cliente inclusa).
    const body = JSON.parse(init.body as string)
    expect(body.model).toBeTruthy()
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.messages[0].content).toContain('minha geladeira parou')
    // Sem thinking: geração de texto pura, mantém a latência baixa.
    expect(body.thinking).toBeUndefined()
  })

  it('junta múltiplos blocos de texto antes de parsear', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: goodJson.slice(0, 20) },
          { type: 'text', text: goodJson.slice(20) },
        ],
        stop_reason: 'end_turn',
      }),
    })
    const output = await anthropicApiProvider.generate(input)
    expect(output.reply).toBe('ok')
  })

  it('lança quando falta a ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_API_KEY = ''
    const fetchMock = mockFetch({ ok: true, json: async () => ({}) })
    await expect(anthropicApiProvider.generate(input)).rejects.toThrow(/ANTHROPIC_API_KEY/)
    // Nem chega a bater na rede sem chave.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lança em resposta não-2xx (ex.: 429)', async () => {
    mockFetch({ ok: false, status: 429, text: async () => 'rate limited' })
    await expect(anthropicApiProvider.generate(input)).rejects.toThrow(/429/)
  })

  it('lança quando o modelo recusa (stop_reason=refusal)', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        content: [],
        stop_reason: 'refusal',
        stop_details: { category: 'cyber' },
      }),
    })
    await expect(anthropicApiProvider.generate(input)).rejects.toThrow(/recusou/)
  })

  it('lança quando a resposta não tem JSON reconhecível', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'sem json aqui' }],
        stop_reason: 'end_turn',
      }),
    })
    await expect(anthropicApiProvider.generate(input)).rejects.toThrow()
  })
})
