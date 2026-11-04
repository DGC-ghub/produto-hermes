import { describe, expect, it } from 'vitest'
import { politicaDeFerramentas } from './ferramentas'

// O que estes testes protegem não é código — é uma DECISÃO.
//
// "Quais ações a IA de um cliente pode executar" é decisão de produto do dono, e a
// resposta para o primeiro piloto foi: nenhuma. A IA responde, usa a base, respeita
// guard-rails e chama humano; não abre chamado, não agenda, não consulta.
//
// Sem um teste, essa decisão viraria um `[]` esquecido no meio de outro arquivo, e o dia
// em que alguém "só ligasse pra testar" nada apontaria que uma escolha do dono mudou.

describe('política determinística de ferramentas (§6.7)', () => {
  it('não habilita NENHUMA ferramenta operacional', () => {
    expect(politicaDeFerramentas()).toEqual([])
  })

  it('devolve um array novo a cada chamada', () => {
    // Uma constante compartilhada faria um chamador que empurrasse um item contaminar
    // TODA config montada depois — inclusive a de outro tenant, no mesmo processo.
    const primeira = politicaDeFerramentas()
    primeira.push({ name: 'abrir_chamado', enabled: true })

    expect(politicaDeFerramentas()).toEqual([])
  })
})
