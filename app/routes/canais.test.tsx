import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MemoryRouter,
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  UNSAFE_RouteContext,
} from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import Canais, { confirmDisconnect, formatLastConn, resolveDisplayStatus } from './canais'

// Duas garantias desta tela: (1) "Desconectar" derruba o WhatsApp da empresa e não pode sair
// num toque só; (2) o status nunca pode dizer "Conectado" quando o servidor não sabe se está.
// A suíte roda em ambiente node, então olhamos a marcação renderizada.

type Session = {
  id: string
  label: string | null
  waNumber: string | null
  status: string
  lastConnAt: string | null
  qrDataUrl: string | null
}

const baseSession: Session = {
  id: 'sess-1',
  label: 'Recepção',
  waNumber: '5511999990000',
  status: 'conectado',
  lastConnAt: '2026-07-20T15:30:00.000Z',
  qrDataUrl: null,
}

/** Renderiza a tela de canais com as sessões dadas (nada é submetido — só marcação). */
function render(sessions: Session[]): string {
  const loaderData = {
    sessions,
    enabled: true,
    operator: { username: 'dono', tenantSlug: 'acme' },
  }
  const Screen = Canais as unknown as (props: { loaderData: typeof loaderData }) => ReactNode
  // Contextos mínimos de um router com dados: `useNavigation`/`useActionData`/`useRevalidator`
  // (e o `<Form>` e o `<NavLink>` da casca) leem daqui.
  const routeContext = {
    matches: [{ route: { id: 'canais' }, pathname: '/canais', pathnameBase: '/' }],
    outlet: null,
    isDataRoute: true,
  }
  const routerContext = { router: { basename: '/' }, navigator: {}, static: false, basename: '/' }
  const state = {
    navigation: { state: 'idle' },
    revalidation: 'idle',
    loaderData: {},
    actionData: undefined,
  }
  return renderToStaticMarkup(
    <MemoryRouter>
      <UNSAFE_DataRouterContext.Provider value={routerContext as never}>
        <UNSAFE_DataRouterStateContext.Provider value={state as never}>
          <UNSAFE_RouteContext.Provider value={routeContext as never}>
            <Screen loaderData={loaderData} />
          </UNSAFE_RouteContext.Provider>
        </UNSAFE_DataRouterStateContext.Provider>
      </UNSAFE_DataRouterContext.Provider>
    </MemoryRouter>,
  )
}

describe('resolveDisplayStatus — o status não pode mentir', () => {
  it('usa o estado ao vivo do gerente quando ele conhece a sessão', () => {
    expect(resolveDisplayStatus('conectado', 'derrubado')).toBe('conectado')
    expect(resolveDisplayStatus('pareando', 'desconectado')).toBe('pareando')
    expect(resolveDisplayStatus('reconectando', 'conectado')).toBe('reconectando')
  })

  it('não repete o "conectado" congelado do banco quando o gerente não conhece a sessão', () => {
    expect(resolveDisplayStatus('desconectado', 'conectado')).toBe('verificando')
    expect(resolveDisplayStatus('desconectado', 'reconectando')).toBe('verificando')
  })

  it('trata pareamento órfão como queda (o QR morreu com o processo)', () => {
    expect(resolveDisplayStatus('desconectado', 'pareando')).toBe('derrubado')
  })

  it('mantém os estados que já são honestos', () => {
    expect(resolveDisplayStatus('desconectado', 'derrubado')).toBe('derrubado')
    expect(resolveDisplayStatus('desconectado', 'desconectado')).toBe('desconectado')
  })
})

describe('formatLastConn', () => {
  it('formata no horário de Brasília', () => {
    expect(formatLastConn('2026-07-20T15:30:00.000Z')).toBe('20/07/2026, 12:30')
  })

  it('devolve null sem data ou com data inválida', () => {
    expect(formatLastConn(null)).toBeNull()
    expect(formatLastConn('nem-data')).toBeNull()
  })
})

describe('confirmDisconnect — ação destrutiva', () => {
  it('cancela o envio quando o cliente não confirma', () => {
    const confirm = vi.fn((_message: string) => false)
    vi.stubGlobal('window', { confirm })
    const preventDefault = vi.fn()
    confirmDisconnect({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    // O texto tem que dizer a consequência real, não só "tem certeza?".
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('escanear o QR de novo'))
    vi.unstubAllGlobals()
  })

  it('deixa passar quando o cliente confirma', () => {
    vi.stubGlobal('window', { confirm: () => true })
    const preventDefault = vi.fn()
    confirmDisconnect({ preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('tela de canais — o que o cliente lê', () => {
  it('mostra "Conectado" só quando a sessão está mesmo no ar', () => {
    const html = render([baseSession])
    // O rótulo vem logo depois do ponto colorido — casa com ele, não com "Desconectar".
    expect(html).toContain('</span>Conectado<')
  })

  it('em verificação, não afirma "Conectado" e diz quando foi a última conexão', () => {
    const html = render([{ ...baseSession, status: 'verificando' }])
    expect(html).toContain('Verificando a conexão')
    expect(html).not.toContain('</span>Conectado<')
    expect(html).toContain('Última conexão: 20/07/2026, 12:30')
    // Sem sessão viva, o caminho de volta (novo QR) tem que estar à mão.
    expect(html).toContain('Reconectar')
  })

  it('avisa quando o número nunca pareou, em vez de inventar uma data', () => {
    const html = render([{ ...baseSession, status: 'derrubado', lastConnAt: null }])
    expect(html).toContain('Este número ainda não pareou.')
  })
})
