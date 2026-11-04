// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Teste do ENCAIXE React — o pedaço que a máquina pura (autosave.test.ts) não alcança:
// se o onChange chega ao reducer, se o debounce dispara UM POST, se a navegação e o envio
// esperam o save certo, se o erro do servidor aparece em role="alert".
//
// A lógica continua sendo testada isolada; aqui só se prova que os fios estão ligados.
// Foi um fio solto (`setSujo(true)` que ninguém chamava) que deixou o autosave morto por
// duas rodadas de revisão.

import PrepararIa from './preparar-ia'

/** Respostas completas: habilitam o botão de envio. */
async function respostasCompletas() {
  const { SETUP_FIELDS } = await import('../lib/setup/answers')
  const answers: Record<string, string | string[]> = {}
  for (const field of SETUP_FIELDS) {
    answers[field.key] =
      field.kind === 'list' ? ['um item bem descritivo'] : 'resposta com folga acima do mínimo'
  }
  return answers
}

type Resposta = { status?: number; body: Record<string, unknown> }

/**
 * Monta a tela com uma action falsa que registra as chamadas.
 *
 * `reter` são os índices dos requests que ficam PENDURADOS até o teste chamar `liberar`.
 * Sem isso não existe janela para digitar durante um save — e a corrida que interessa
 * (continuar escrevendo enquanto o request do clique está em voo) fica sem cobertura.
 */
async function montar(
  opcoes: { completo?: boolean; respostas?: Resposta[]; reter?: number[] } = {},
) {
  const answers = opcoes.completo ? await respostasCompletas() : {}
  const { SETUP_STEPS, isStepComplete, missingFieldsByStep, setupProgress } = await import(
    '../lib/setup/answers'
  )

  const chamadas: FormData[] = []
  const fila = [...(opcoes.respostas ?? [])]
  const reter = opcoes.reter ?? []
  const portoes = new Map<number, () => void>()
  let revisao = 3

  // Cada passagem do loader com a etapa pedida e QUANTOS posts já tinham saído. É assim
  // que se observa a ordem "navegou depois de qual save" sem depender de quando o React
  // termina de pintar a tela nova.
  const carregamentos: Array<{ etapa: string; posts: number }> = []

  const Stub = createRoutesStub([
    {
      path: '/preparar-ia',
      Component: PrepararIa as never,
      loader: ({ request }) => {
        // O stub precisa ler a etapa da URL, senão a navegação (que é ?etapa=) não muda
        // nada e o teste de "só troca depois do save" provaria o oposto do que diz.
        const etapa =
          new URL(request.url).searchParams.get('etapa') ??
          (opcoes.completo ? 'seguranca' : 'empresa')
        carregamentos.push({ etapa, posts: chamadas.length })
        return {
          step: etapa,
          versionId: 'ver-1',
          revision: revisao,
          state: 'draft',
          reviewNote: null,
          published: false,
          activated: false,
          answers,
          progress: setupProgress(answers),
          stepsDone: SETUP_STEPS.map((s) => isStepComplete(s, answers)),
          missing: missingFieldsByStep(answers),
          operator: { username: 'dono@acme.com', tenantSlug: 'acme' },
        }
      },
      action: async ({ request }) => {
        const form = await request.formData()
        const indice = chamadas.length
        chamadas.push(form)
        if (reter.includes(indice)) {
          await new Promise<void>((resolve) => portoes.set(indice, resolve))
        }
        const proxima = fila.shift()
        if (proxima) {
          return new Response(JSON.stringify(proxima.body), {
            status: proxima.status ?? 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        revisao += 1
        return { ok: true, stale: false, revision: revisao }
      },
    },
  ])

  render(<Stub initialEntries={['/preparar-ia']} />)
  await screen.findByRole('heading', { name: /preparar sua ia/i })

  /**
   * Solta a resposta de um request retido. Lança se não havia nada retido ali — um
   * `liberar` que não libera nada faria o teste "passar" sem exercitar corrida nenhuma.
   */
  function liberar(indice: number) {
    const abrir = portoes.get(indice)
    if (!abrir) {
      throw new Error(`nenhum request retido no índice ${indice}`)
    }
    portoes.delete(indice)
    abrir()
  }

  return { chamadas, liberar, carregamentos }
}

/** O texto do rótulo de estado ("salvando…" / "salvo às HH:MM"). */
function estado(): string {
  return screen.getByRole('status').textContent ?? ''
}

/** A etapa 2 está na tela? É por ela que se vê se a navegação aconteceu. */
function naEtapaDeServicos(): boolean {
  return screen.queryByLabelText(/quais serviços vocês oferecem/i) !== null
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('autosave — o fio que estava solto', () => {
  it('montar a tela NÃO dispara POST', async () => {
    const { chamadas } = await montar()
    await vi.advanceTimersByTimeAsync(3000)
    expect(chamadas).toHaveLength(0)
  })

  it('digitar dispara exatamente UM POST depois do debounce', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { chamadas } = await montar()

    const campo = screen.getByLabelText(/nome da empresa/i)
    await user.type(campo, 'Clínica Bem Estar')

    // Antes de 1,2s: nada.
    expect(chamadas).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1300)
    await waitFor(() => expect(chamadas).toHaveLength(1))
    expect(chamadas[0].get('nome')).toContain('Clínica Bem Estar')
  })

  it('digitar várias vezes seguidas ainda dá UM POST — o debounce reinicia', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { chamadas } = await montar()

    const campo = screen.getByLabelText(/nome da empresa/i)
    await user.type(campo, 'abc')
    await vi.advanceTimersByTimeAsync(400)
    await user.type(campo, 'def')
    await vi.advanceTimersByTimeAsync(400)
    await user.type(campo, 'ghi')
    await vi.advanceTimersByTimeAsync(1300)

    await waitFor(() => expect(chamadas).toHaveLength(1))
  })

  it('o POST leva a revisão que o servidor devolveu, não a do loader', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { chamadas } = await montar()
    const campo = screen.getByLabelText(/nome da empresa/i)

    await user.type(campo, 'primeiro')
    await vi.advanceTimersByTimeAsync(1300)
    await waitFor(() => expect(chamadas).toHaveLength(1))
    expect(chamadas[0].get('revision')).toBe('3')

    await user.type(campo, ' segundo')
    await vi.advanceTimersByTimeAsync(1300)
    await waitFor(() => expect(chamadas).toHaveLength(2))
    // 4 = a revisão devolvida pelo primeiro save. Mandar 3 de novo levaria 409.
    expect(chamadas[1].get('revision')).toBe('4')
  })
})

describe('navegação espera o save', () => {
  it('"Salvar e continuar" manda o POST e só então troca de etapa', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { chamadas } = await montar()

    await user.type(screen.getByLabelText(/nome da empresa/i), 'Acme')
    await user.click(screen.getByRole('button', { name: /salvar e continuar/i }))

    await waitFor(() => expect(chamadas.length).toBeGreaterThanOrEqual(1))
    // Chegou na etapa seguinte só depois da resposta.
    await waitFor(() =>
      expect(screen.getByLabelText(/quais serviços vocês oferecem/i)).toBeTruthy(),
    )
  })

  it('conflito (409) NÃO troca de etapa e mostra o aviso', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await montar({
      respostas: [{ status: 409, body: { ok: false, stale: true, error: 'conflito de aba' } }],
    })

    await user.type(screen.getByLabelText(/nome da empresa/i), 'Acme')
    await user.click(screen.getByRole('button', { name: /salvar e continuar/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    // Continua na etapa 1: o campo da etapa 2 não está na tela.
    expect(screen.queryByLabelText(/quais serviços vocês oferecem/i)).toBeNull()
  })
})

describe('erros do servidor aparecem em role="alert"', () => {
  const casos: Array<[string, number, Record<string, unknown>]> = [
    ['409 conflito', 409, { ok: false, stale: true, error: 'outra aba salvou' }],
    ['422 incompleto', 422, { ok: false, stale: false, error: 'Ainda faltam informações' }],
    ['500 falha', 500, { ok: false, stale: false, error: 'Não consegui salvar agora' }],
  ]

  it.each(casos)('%s vira alerta', async (_label, status, body) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await montar({ respostas: [{ status, body }] })

    await user.type(screen.getByLabelText(/nome da empresa/i), 'Acme')
    await vi.advanceTimersByTimeAsync(1300)

    await waitFor(() => {
      const alerta = screen.getByRole('alert')
      expect(alerta.textContent).toBeTruthy()
    })
  })

  it('depois de um conflito, digitar não dispara mais POST', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { chamadas } = await montar({
      respostas: [{ status: 409, body: { ok: false, stale: true, error: 'conflito' } }],
    })

    await user.type(screen.getByLabelText(/nome da empresa/i), 'Acme')
    await vi.advanceTimersByTimeAsync(1300)
    await waitFor(() => expect(chamadas).toHaveLength(1))

    // Insistir sobrescreveria o que a outra aba gravou.
    await user.type(screen.getByLabelText(/nome da empresa/i), ' mais texto')
    await vi.advanceTimersByTimeAsync(3000)
    expect(chamadas).toHaveLength(1)
  })
})

// ── As corridas do `dirty` ────────────────────────────────────────────────────
// Os testes acima usam uma action que responde na hora: não existe janela para digitar
// durante um save, então a corrida que mais custa caro — a pessoa continua escrevendo
// enquanto o request do clique está em voo — passava batida. Aqui o teste segura a
// resposta e escreve dentro dessa janela.

describe('editar durante o save de navegação', () => {
  it('a etapa só troca depois de um SEGUNDO save, com o texto novo', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    // Os dois requests ficam retidos: assim nada avança por conta do relógio, e a negativa
    // ("ainda não trocou de etapa") não depende de quanto tempo o teste deixou passar.
    const { chamadas, liberar, carregamentos } = await montar({ reter: [0, 1] })

    await user.type(screen.getByLabelText(/nome da empresa/i), 'Acme')
    await user.click(screen.getByRole('button', { name: /salvar e continuar/i }))
    await waitFor(() => expect(chamadas).toHaveLength(1))
    expect(chamadas[0].get('nome')).toBe('Acme')

    // Digita COM o request em voo: este texto não está no save que vai responder.
    await user.type(screen.getByLabelText(/nome da empresa/i), ' Saúde')

    liberar(0)
    await waitFor(() => expect(estado()).toMatch(/salvo/))

    // O segundo save sai pelo debounce, levando o texto completo.
    await vi.advanceTimersByTimeAsync(1300)
    await waitFor(() => expect(chamadas).toHaveLength(2))
    expect(chamadas[1].get('nome')).toBe('Acme Saúde')

    // E só quando ELE confirma a etapa troca.
    liberar(1)
    await waitFor(() => expect(naEtapaDeServicos()).toBe(true))

    // A prova de ORDEM, e é ela que discrimina: quando o loader foi chamado para a etapa
    // 2, os DOIS saves já tinham saído. Se a navegação se contentasse com a resposta do
    // save do clique, ele teria sido chamado com um só — e " Saúde" iria embora sem nunca
    // ter sido gravado. (a contagem, e não a tela, porque a pintura da etapa nova é
    // assíncrona: "ainda não apareceu" não prova "ainda não navegou")
    const idaParaServicos = carregamentos.find((c) => c.etapa === 'servicos')
    expect(idaParaServicos?.posts).toBe(2)
  })
})

describe('editar durante o save de envio', () => {
  it('o envio só sai depois de um SEGUNDO save, com o texto novo', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { chamadas, liberar } = await montar({ completo: true, reter: [0, 1] })
    const enviou = () => chamadas.some((c) => c.get('intent') === 'enviar')

    await user.click(screen.getByRole('button', { name: /enviar para revisão/i }))
    await waitFor(() => expect(chamadas).toHaveLength(1))
    expect(chamadas[0].get('intent')).not.toBe('enviar')

    await user.type(screen.getByLabelText(/nunca pode prometer/i), '\nnada de prazo curto')

    liberar(0)
    await waitFor(() => expect(estado()).toMatch(/salvo/))

    // Enviar agora mandaria para revisão uma versão sem a última correção — e nossa equipe
    // revisaria material velho.
    expect(enviou()).toBe(false)

    await vi.advanceTimersByTimeAsync(1300)
    await waitFor(() => expect(chamadas).toHaveLength(2))
    expect(chamadas[1].get('nuncaPrometer')).toContain('nada de prazo curto')
    expect(enviou()).toBe(false)

    liberar(1)
    await waitFor(() => expect(enviou()).toBe(true))
  })
})

describe('conflito trava também o clique manual', () => {
  it('depois do 409 os botões de etapa ficam desabilitados e não sai mais POST', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { chamadas } = await montar({
      respostas: [{ status: 409, body: { ok: false, stale: true, error: 'mensagem-do-servidor' } }],
    })

    await user.type(screen.getByLabelText(/nome da empresa/i), 'Acme')
    await vi.advanceTimersByTimeAsync(1300)
    await waitFor(() => expect(chamadas).toHaveLength(1))
    // O aviso de CONFLITO, não o de erro genérico: só ele prova que a máquina bloqueou.
    // (o texto do conflito é da tela; o do erro genérico viria do corpo da resposta)
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Recarregue a página/),
    )

    // O 409 zera `pending`. Olhando só para ele, o botão voltava a ficar clicável — e o
    // clique manda um POST com a revisão que o servidor acabou de recusar.
    const botaoEtapa = screen.getByRole('button', { name: /serviços/i }) as HTMLButtonElement
    expect(botaoEtapa.disabled).toBe(true)

    await user.click(botaoEtapa)
    await vi.advanceTimersByTimeAsync(1300)
    expect(chamadas).toHaveLength(1)
    expect(naEtapaDeServicos()).toBe(false)
  })
})

describe('envio para revisão salva antes', () => {
  it('clicar em enviar dispara um save e, depois dele, o envio', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { chamadas } = await montar({ completo: true })

    await user.type(screen.getByLabelText(/nunca pode prometer/i), '\nprazo curto')
    await user.click(screen.getByRole('button', { name: /enviar para revisão/i }))

    // Primeiro um save (sem intent), depois o envio (intent=enviar).
    await waitFor(() => expect(chamadas.length).toBeGreaterThanOrEqual(2))
    expect(chamadas[0].get('intent')).not.toBe('enviar')
    await waitFor(() => {
      expect(chamadas.some((c) => c.get('intent') === 'enviar')).toBe(true)
    })
  })
})
