import { describe, expect, it } from 'vitest'
import { demoNeedsHuman, demoRedirectPath } from './demo.chat'

// O TRANSPORTE DO AVISO DA DEMO (§7.3).
//
// Este arquivo existe por causa de uma regressão que quase passou calada. A demo pública
// mostrava "vou chamar uma pessoa" lendo o STATUS PERSISTIDO da conversa. Quando ela passou
// a `public_demo` — sem efeitos operacionais, para a Central do cliente não receber visitante
// anônimo na fila —, o status deixou de mudar. O aviso sumiria da tela sem nenhum teste
// falhando: o comportamento visível quebrava e a suíte continuava verde.
//
// O aviso passou a viajar na URL do redirect, e é isso que se prova aqui.

describe('demoRedirectPath', () => {
  const base = { tenantSlug: 'dgc', conversationId: 'conv-1' }

  it('preserva tenant e conversa', () => {
    const caminho = demoRedirectPath({ ...base, needsHuman: false })

    expect(caminho).toContain('tenant=dgc')
    expect(caminho).toContain('conversationId=conv-1')
  })

  it('needsHuman=true leva o aviso', () => {
    expect(demoRedirectPath({ ...base, needsHuman: true })).toContain('humano=1')
  })

  it('needsHuman=false NÃO leva o aviso', () => {
    // O par que importa: sem isto, o aviso de uma rodada ficaria colado na tela para sempre.
    expect(demoRedirectPath({ ...base, needsHuman: false })).not.toContain('humano')
  })

  it('o ida-e-volta fecha: o que a action escreve, o loader lê', () => {
    // A prova do transporte inteiro, sem subir a rota: as duas pontas do mesmo parâmetro.
    for (const needsHuman of [true, false]) {
      const url = new URL(demoRedirectPath({ ...base, needsHuman }), 'https://h')
      expect(demoNeedsHuman(url), `needsHuman=${needsHuman}`).toBe(needsHuman)
    }
  })
})

describe('demoNeedsHuman', () => {
  const lido = (busca: string) => demoNeedsHuman(new URL(`https://h/demo/chat${busca}`))

  it('lê o aviso quando presente', () => {
    expect(lido('?tenant=dgc&humano=1')).toBe(true)
  })

  it('ausente é false', () => {
    expect(lido('?tenant=dgc')).toBe(false)
  })

  it.each([
    '?humano=',
    '?humano=0',
    '?humano=true',
    '?humano=sim',
    '?humano=11',
  ])('só `1` conta — %s é false', (busca) => {
    // Estreito de propósito: o parâmetro vem da URL, ou seja, do visitante. Aceitar
    // qualquer valor "verdadeiro" deixaria qualquer pessoa forçar o aviso na tela.
    expect(lido(busca)).toBe(false)
  })
})
