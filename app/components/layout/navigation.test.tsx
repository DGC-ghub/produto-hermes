import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { NAV } from './AppShell'
import { PublicHeader } from './PublicHeader'

/** Marcação do header público, sem DOM (a suíte roda em ambiente node). */
function renderPublicHeader() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PublicHeader />
    </MemoryRouter>,
  )
}

describe('PublicHeader', () => {
  it('manda o "Testar grátis" para o cadastro, não para o login', () => {
    const html = renderPublicHeader()
    // Destino do link que embrulha o botão primário.
    const href = html.match(/<a[^>]+href="([^"]+)"[^>]*>\s*<button[^>]*>Testar grátis/)?.[1]
    expect(href).toBe('/signup')
  })

  it('mantém o "Entrar" apontando para o login', () => {
    expect(renderPublicHeader()).toMatch(/<a[^>]+href="\/login"[^>]*>Entrar<\/a>/)
  })

  it('esconde o "Demo" abaixo do breakpoint sm e usa padding menor no celular', () => {
    const html = renderPublicHeader()
    expect(html).toMatch(/class="[^"]*hidden[^"]*sm:inline[^"]*"[^>]*>\s*Demo/)
    expect(html).toMatch(/<header class="[^"]*px-4[^"]*sm:px-6[^"]*"/)
  })
})

describe('NAV do AppShell', () => {
  it('nomeia o caminho self-service de forma inequívoca', () => {
    expect(NAV.find((item) => item.to === '/canais')?.label).toBe('Conectar WhatsApp')
  })

  it('não oferece o fluxo oficial no menu principal', () => {
    expect(NAV.some((item) => item.to === '/conectar-whatsapp')).toBe(false)
  })

  it('não repete rótulo entre os itens', () => {
    const labels = NAV.map((item) => item.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
