import { describe, expect, it, vi } from 'vitest'

// A ACTION da Central, com as bordas mockadas.
//
// O elo que faltava. O `operator-reply.server.ts` prova que o SERVIDOR distingue "não enviei"
// de "não sei se enviei", e o `atendente.test.tsx` prova que a TELA pinta os dois de forma
// diferente. Entre os dois está esta `action` — e enquanto ela não tinha prova, apagar o
// `ambiguous` do retorno deixava a suíte inteira verde: o desfecho ambíguo voltaria à caixa
// vermelha de "falhou", e o operador reenviaria uma mensagem que o cliente talvez já tenha
// recebido.
//
// Arquivo separado de `atendente.test.tsx` para os mocks não valerem para os testes de
// marcação.

vi.mock('../lib/auth.server', () => ({
  requireOperator: vi.fn(async () => ({
    tenantId: 'tenant-1',
    tenantSlug: 'acme',
    username: 'dono',
  })),
}))

const envio = vi.hoisted(() => ({
  resultado: { ok: true } as { ok: boolean; error?: string; ambiguous?: boolean },
}))

vi.mock('../lib/operator-reply.server', () => ({
  sendOperatorReply: vi.fn(async () => envio.resultado),
}))

vi.mock('../db.server', () => ({ db: {} }))

const { action } = await import('./atendente')

function responder() {
  const body = new FormData()
  body.append('intent', 'reply')
  body.append('contactId', '5511999990000')
  body.append('text', 'Já verifiquei aqui')
  return action({
    request: new Request('https://h/atendente', { method: 'POST', body }),
  } as Parameters<typeof action>[0])
}

describe('a action carrega a DÚVIDA adiante, não só um erro', () => {
  it('ambíguo chega à tela marcado como ambíguo', async () => {
    envio.resultado = {
      ok: false,
      ambiguous: true,
      error: 'A confirmação do WhatsApp não voltou.',
    }

    const resultado = (await responder()) as { error?: string; ambiguous?: boolean }

    expect(resultado.ambiguous).toBe(true)
    expect(resultado.error).toBe('A confirmação do WhatsApp não voltou.')
  })

  it('falha definitiva NÃO é marcada como ambígua', async () => {
    // O par negativo: sem ele, marcar tudo como ambíguo passaria no teste de cima — e a tela
    // deixaria de avisar em vermelho o que realmente precisa de conserto (número desconectado).
    envio.resultado = { ok: false, error: 'O envio pelo WhatsApp falhou.' }

    const resultado = (await responder()) as { error?: string; ambiguous?: boolean }

    expect(resultado.ambiguous).toBe(false)
  })

  it('sucesso não devolve erro nenhum — redireciona para a ficha do contato', async () => {
    envio.resultado = { ok: true }

    const resultado = (await responder()) as Response

    expect(resultado.status).toBe(302)
    expect(resultado.headers.get('location')).toBe('/atendente?contactId=5511999990000')
  })
})
