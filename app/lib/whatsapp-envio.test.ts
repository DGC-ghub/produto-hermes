// A CLASSIFICAÇÃO DO ENVIO NO CANAL META.
//
// O transporte devolvia `boolean`, e nele "não enviei" e "não sei se enviei" eram o mesmo
// valor. A distinção que este arquivo prova é a que decide se o sistema PODE reenviar:
//
//   not_sent  → nada saiu. Reenviar é seguro (e `retryable` diz se vale a pena).
//   ambiguous → pode ter saído. Reenviar duplica no cliente.
//   sent      → saiu, e temos o comprovante do provedor.
//
// O caso 6 é o mais sutil: HTTP 200 sem `wamid` no corpo. É tentador chamar de `sent` — o
// provedor respondeu OK. Mas sem comprovante não há como saber depois o que aconteceu com
// aquela mensagem, e `sent` sem id recriaria dentro do tipo a ambiguidade que ele elimina.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendWhatsAppMessage } from './whatsapp.server'

const NUMERO = '5511999990000'
const PHONE_ID = 'phone-envio-teste'

function respostaDaMeta(status: number, corpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  } as unknown as Response
}

beforeEach(() => {
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'token-de-teste')
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', PHONE_ID)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('classificação do envio (Meta)', () => {
  it('1. timeout de rede é AMBÍGUO — a requisição pode ter chegado', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed: ETIMEDOUT'))

    const r = await sendWhatsAppMessage(NUMERO, 'oi', PHONE_ID)

    expect(r.status).toBe('ambiguous')
  })

  it('2. HTTP 400 é NÃO ENVIADO e não vale tentar de novo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respostaDaMeta(400, { error: { message: 'parâmetro inválido' } }),
    )

    const r = await sendWhatsAppMessage(NUMERO, 'oi', PHONE_ID)

    expect(r.status).toBe('not_sent')
    expect(r.status === 'not_sent' && r.retryable).toBe(false)
  })

  it('3. HTTP 429 é NÃO ENVIADO mas vale tentar de novo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaDaMeta(429, { error: {} }))

    const r = await sendWhatsAppMessage(NUMERO, 'oi', PHONE_ID)

    expect(r.status).toBe('not_sent')
    expect(r.status === 'not_sent' && r.retryable).toBe(true)
  })

  it('4. HTTP 5xx é AMBÍGUO — o servidor pode ter processado antes de falhar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaDaMeta(503, { error: {} }))

    const r = await sendWhatsAppMessage(NUMERO, 'oi', PHONE_ID)

    expect(r.status).toBe('ambiguous')
  })

  it('5. HTTP 200 com wamid é ENVIADO, e o comprovante vem junto', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respostaDaMeta(200, { messages: [{ id: 'wamid.ABC123' }] }),
    )

    const r = await sendWhatsAppMessage(NUMERO, 'oi', PHONE_ID)

    expect(r.status).toBe('sent')
    expect(r.status === 'sent' && r.providerMessageId).toBe('wamid.ABC123')
  })

  it('6. HTTP 200 SEM wamid é AMBÍGUO, não enviado-com-sucesso', async () => {
    // Sem comprovante não há como saber depois o que aconteceu com esta mensagem. Chamar de
    // `sent` aqui autorizaria o resto do sistema a seguir em frente com uma certeza que não
    // existe.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaDaMeta(200, { messages: [] }))

    const r = await sendWhatsAppMessage(NUMERO, 'oi', PHONE_ID)

    expect(r.status).toBe('ambiguous')
  })

  it('6b. HTTP 200 com JSON inválido também é AMBÍGUO', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token < in JSON')
      },
      text: async () => '<html>',
    } as unknown as Response)

    const r = await sendWhatsAppMessage(NUMERO, 'oi', PHONE_ID)

    expect(r.status).toBe('ambiguous')
  })

  it('sem token configurado é NÃO ENVIADO definitivo — nada saiu', async () => {
    // ⚠️ O nome do env importa: a primeira versão deste arquivo usava `WHATSAPP_TOKEN`, que
    // não existe. Todos os casos caíam em "sem token" antes de chegar ao `fetch`, e ESTE teste
    // passava pelo motivo errado — não por mérito da implementação.
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const r = await sendWhatsAppMessage(NUMERO, 'oi', PHONE_ID)

    expect(r.status).toBe('not_sent')
    expect(r.status === 'not_sent' && r.retryable).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
