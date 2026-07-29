import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { LEGAL_ENTITY } from '../lib/legal'
import { TRIAL_DAYS } from '../lib/plans'
import Home from './home'
import Privacidade from './privacidade'
import Termos from './termos'

// Os dois documentos legais são um par: destravam a homologação do Mercado Pago e
// respondem pela LGPD. O teste guarda o que não pode sumir numa edição de texto —
// e, principalmente, que nenhum campo pendente vaze para o ar sem o realce.

/** Marcação da página, sem DOM (a suíte roda em ambiente node). */
function render(element: ReactElement) {
  return renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>)
}

/** O HTML sem os trechos dentro de <mark> — onde os pendentes deveriam estar. */
function foraDoRealce(html: string) {
  return html.replace(/<mark[^>]*>[\s\S]*?<\/mark>/g, '')
}

describe('Termos de Uso', () => {
  const html = render(<Termos />)

  it('avisa que a resposta é gerada por IA e pode errar', () => {
    expect(html).toContain('inteligência artificial')
    expect(html).toMatch(/pode errar/)
    expect(html).toMatch(/revisar tudo que for crítico/)
  })

  it('exige do cliente a base legal para tratar as conversas dos clientes dele', () => {
    expect(html).toContain('base legal')
    expect(html).toContain('controlador')
    expect(html).toContain('operador')
  })

  it('proíbe disparo em massa e avisa do bloqueio do número por QR code', () => {
    // O ponto mais caro do produto: conexão por QR está fora da API oficial, e o
    // WhatsApp pode banir o número. Se este aviso sumir do texto, o teste cai.
    expect(html).toContain('disparo em massa')
    expect(html).toContain('QR code')
    expect(html).toMatch(/banir o seu número|banimento/)
  })

  it('descreve teste grátis, cobrança e cancelamento', () => {
    expect(html).toContain(`${TRIAL_DAYS} dias de teste`)
    expect(html).toContain('Mercado Pago')
    expect(html).toContain('Cancele quando quiser')
  })

  it('limita a responsabilidade e elege o foro', () => {
    expect(html).toContain('lucro cessante')
    expect(html).toContain('foro da comarca')
  })

  it('não deixa nenhum campo pendente fora do realce', () => {
    expect(foraDoRealce(html)).not.toContain('[PREENCHER')
  })

  it('leva para a Política de Privacidade', () => {
    expect(html).toContain('href="/privacidade"')
  })
})

describe('Política de Privacidade', () => {
  const html = render(<Privacidade />)

  it('separa quem é controlador de quem é operador', () => {
    expect(html).toContain('controlador')
    expect(html).toContain('operador')
    expect(html).toContain('LGPD')
  })

  it('diz que o conteúdo das conversas vai para um modelo de IA', () => {
    expect(html).toContain('modelo de IA')
    expect(html).toContain('transferência internacional')
  })

  it('informa retenção, direitos do titular e o encarregado', () => {
    expect(html).toMatch(/Depois do cancelamento/)
    expect(html).toContain('art. 18')
    expect(html).toContain('Encarregado')
  })

  it('explica o caminho de quem é cliente do cliente', () => {
    expect(html).toMatch(/procure essa empresa/)
  })

  it('não deixa nenhum campo pendente fora do realce', () => {
    expect(foraDoRealce(html)).not.toContain('[PREENCHER')
  })

  it('mostra o e-mail do encarregado como canal do titular', () => {
    // Vem de app/lib/legal.ts: preencher lá tem que valer aqui, sem editar a página.
    expect(html).toContain(LEGAL_ENTITY.emailEncarregado)
  })
})

describe('rodapé da home', () => {
  it('linka os dois documentos', () => {
    const html = render(<Home />)
    expect(html).toContain('href="/termos"')
    expect(html).toContain('href="/privacidade"')
  })
})
