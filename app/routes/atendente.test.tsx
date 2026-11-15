import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { ContactDossier } from '../lib/dossier.server'
import { renderRoute } from '../lib/render-route.test-util'
import Atendente, { replyComposerKey } from './atendente'

// A Central tem VÁRIOS forms na mesma tela e duas ações lentas (resumo pela IA, resposta pelo
// WhatsApp). Estes testes olham a marcação renderizada — a suíte roda em ambiente node — para
// garantir que o botão em voo trava e que os outros continuam clicáveis.

const dossier: ContactDossier = {
  contactId: '5511999990000',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  status: 'needs_human',
  handoffReason: 'requested_human',
  lead: null,
  tickets: [
    {
      id: 'tkt-1',
      subject: 'Segunda via do boleto',
      status: 'aberto',
      category: null,
      createdAt: '2026-07-20T12:00:00.000Z',
    },
    {
      id: 'tkt-2',
      subject: 'Troca de titularidade',
      status: 'aberto',
      category: null,
      createdAt: '2026-07-20T12:00:00.000Z',
    },
  ],
  openTicketCount: 2,
  recentMessages: [{ id: 'msg-1', role: 'user', content: 'Preciso falar com alguém' }],
  headline: 'Maria',
  priority: 'alta',
  summary: null,
}

const loaderData = {
  queue: [],
  dossier,
  onboarding: { steps: [], doneCount: 3, total: 3, allDone: true },
  operator: { username: 'dono', tenantSlug: 'acme' },
  selected: { contactId: dossier.contactId },
}

// A tela é um componente de rota; aqui só o `loaderData` importa.
const Screen = Atendente as unknown as (props: { loaderData: typeof loaderData }) => ReactNode

/**
 * Renderiza a Central com uma submissão em voo (ou nenhuma, quando `formData` é omitido) e,
 * opcionalmente, com o desfecho de uma ação já concluída (`actionData`) — é por ele que a tela
 * fica sabendo se o envio falhou ou apenas ficou em dúvida.
 */
function render(formData?: FormData, actionData?: { error?: string; ambiguous?: boolean }): string {
  return renderRoute({
    id: 'atendente',
    path: '/atendente',
    Screen,
    loaderData,
    navigation: formData ? { state: 'submitting', formData } : undefined,
    actionData,
  })
}

/** O `<button>` cujo texto visível é `label`, com todos os seus atributos. */
function buttonWith(html: string, label: string): string | undefined {
  return html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0]
}

/**
 * O botão de rótulo `label` está travado? (A classe do componente contém
 * `disabled:opacity-60` sempre, então só vale o ATRIBUTO `disabled`.)
 */
function isDisabled(html: string, label: string): boolean {
  const button = buttonWith(html, label)
  expect(button, `botão "${label}" não encontrado na tela`).toBeDefined()
  return / disabled=""/.test(String(button))
}

/** As classes da caixa de aviso que envolve exatamente esta mensagem. */
function bannerClasses(html: string, message: string): string {
  const escaped = message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`<div class="([^"]*)">${escaped}</div>`))
  expect(match, `caixa com a mensagem "${message}" não encontrada na tela`).not.toBeNull()
  return String(match?.[1])
}

function submission(entries: Record<string, string>): FormData {
  const formData = new FormData()
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value)
  }
  return formData
}

describe('Central do atendente — editor da resposta', () => {
  it('troca a identidade do editor quando uma resposta é persistida', () => {
    const before = replyComposerKey(dossier)
    const after = replyComposerKey({
      ...dossier,
      recentMessages: [
        ...dossier.recentMessages,
        { id: 'msg-resposta-enviada', role: 'assistant', content: 'Respondido' },
      ],
    })

    expect(after).not.toBe(before)
  })

  it('mantém a identidade quando o envio falha e nenhuma mensagem é persistida', () => {
    expect(replyComposerKey({ ...dossier })).toBe(replyComposerKey(dossier))
  })
})

describe('a dúvida do envio chega à TELA como dúvida, não como falha', () => {
  // A prova do `operator-reply.server.ts` para no servidor: ela mostra que o TEXTO muda. Mas
  // quem induz (ou não) o segundo clique é a tela, e ali o desfecho ambíguo passava pela mesma
  // caixa vermelha de "falhou" até a `action` carregar o `ambiguous` adiante. Sem esta prova,
  // apagar o ternário do banner deixava a suíte inteira verde.
  const AMBIGUO = 'Registrei a mensagem, mas a confirmação do WhatsApp não voltou.'
  const FALHOU = 'Registrei a mensagem, mas o envio pelo WhatsApp falhou.'

  it('ambíguo aparece como AVISO — sem o vermelho que empurra para reenviar', () => {
    const html = render(undefined, { error: AMBIGUO, ambiguous: true })

    const classes = bannerClasses(html, AMBIGUO)
    expect(classes).toContain('bg-waiting/10')
    expect(classes).not.toContain('text-urgent')
  })

  it('falha definitiva continua vermelha — os dois casos NÃO se parecem', () => {
    // O par negativo. Sem ele, "tudo amarelo" também passaria no teste de cima, e o operador
    // perderia o sinal de que precisa mesmo conferir o número conectado.
    const html = render(undefined, { error: FALHOU, ambiguous: false })

    const classes = bannerClasses(html, FALHOU)
    expect(classes).toContain('text-urgent')
    expect(classes).not.toContain('bg-waiting/10')
  })
})

describe('Central do atendente — feedback nas ações', () => {
  it('deixa todos os botões clicáveis quando nada está em voo', () => {
    const html = render()
    expect(isDisabled(html, 'Gerar')).toBe(false)
    expect(isDisabled(html, 'Enviar resposta')).toBe(false)
    expect(isDisabled(html, 'Assumir conversa')).toBe(false)
    expect(isDisabled(html, 'Resolver')).toBe(false)
  })

  it('trava o "Enviar resposta" durante o envio — dois cliques mandariam duas mensagens', () => {
    const html = render(submission({ intent: 'reply', contactId: dossier.contactId, text: 'Oi' }))
    expect(isDisabled(html, 'Enviando…')).toBe(true)
    expect(buttonWith(html, 'Enviar resposta')).toBeUndefined()
  })

  it('mostra progresso no resumo sem travar os outros forms', () => {
    const html = render(submission({ intent: 'summary', contactId: dossier.contactId }))
    expect(isDisabled(html, 'Gerando resumo…')).toBe(true)
    // O envio da resposta e as ações de conversa seguem disponíveis.
    expect(isDisabled(html, 'Enviar resposta')).toBe(false)
    expect(isDisabled(html, 'Assumir conversa')).toBe(false)
  })

  it('trava só a linha do chamado enviado, não a do vizinho', () => {
    const html = render(
      submission({ contactId: dossier.contactId, ticketId: 'tkt-1', ticketStatus: 'resolvido' }),
    )
    expect(isDisabled(html, 'Salvando…')).toBe(true)
    // Sobra exatamente um "Resolver" — o do outro chamado — e ele continua clicável.
    expect(html.match(/>Resolver</g)).toHaveLength(1)
    expect(isDisabled(html, 'Resolver')).toBe(false)
  })

  it('trava só a ação de conversa enviada', () => {
    const html = render(submission({ contactId: dossier.contactId, action: 'assumir' }))
    expect(isDisabled(html, 'Assumindo…')).toBe(true)
    expect(isDisabled(html, 'Encerrar')).toBe(false)
  })
})
