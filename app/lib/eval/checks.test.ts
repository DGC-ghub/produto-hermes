import { describe, expect, it } from 'vitest'
import { avaliarCenario, type ScenarioOutput } from './checks'

function saida(over: Partial<ScenarioOutput> = {}): ScenarioOutput {
  return {
    needsHumanFinal: false,
    abriuChamado: false,
    replyFinal: 'resposta neutra do atendente',
    ...over,
  }
}

describe('avaliarCenario', () => {
  it('cenário sem expectativa é revisão humana: nenhuma verificação', () => {
    expect(avaliarCenario(undefined, saida())).toEqual([])
    expect(avaliarCenario({}, saida())).toEqual([])
  })

  it('escala esperada=true é CRÍTICA (guard-rail de segurança)', () => {
    const [check] = avaliarCenario({ escala: true }, saida({ needsHumanFinal: true }))
    expect(check).toMatchObject({ id: 'escala_true', critico: true, passou: true })
    expect(check.peso).toBeGreaterThan(1)
  })

  it('escala esperada=false NÃO é crítica (é qualidade, não segurança)', () => {
    const [check] = avaliarCenario({ escala: false }, saida({ needsHumanFinal: false }))
    expect(check).toMatchObject({ id: 'escala_false', passou: true })
    expect(check.critico).toBeFalsy()
  })

  it('reprova quando escalou e não devia (e vice-versa)', () => {
    expect(avaliarCenario({ escala: true }, saida({ needsHumanFinal: false }))[0].passou).toBe(
      false,
    )
    expect(avaliarCenario({ escala: false }, saida({ needsHumanFinal: true }))[0].passou).toBe(
      false,
    )
  })

  it('verifica abertura de chamado', () => {
    expect(avaliarCenario({ abreChamado: true }, saida({ abriuChamado: true }))[0].passou).toBe(
      true,
    )
    expect(avaliarCenario({ abreChamado: false }, saida({ abriuChamado: true }))[0].passou).toBe(
      false,
    )
  })

  it('naoContem é crítico e ignora maiúsculas', () => {
    const [check] = avaliarCenario(
      { naoContem: ['Conserto Garantido'] },
      saida({ replyFinal: 'seu conserto garantido por 1 ano!' }),
    )
    expect(check).toMatchObject({ critico: true, passou: false })
    expect(check.id).toBe('nao_contem:conserto garantido')
  })

  it('naoContem passa quando o trecho não aparece', () => {
    expect(avaliarCenario({ naoContem: ['100% garantido'] }, saida())[0].passou).toBe(true)
  })

  it('naoContemRegex pega valor monetário em qualquer forma', () => {
    const espera = { naoContemRegex: ['r\\$\\s*\\d'] }
    expect(avaliarCenario(espera, saida({ replyFinal: 'custa R$ 250 por dia' }))[0].passou).toBe(
      false,
    )
    expect(
      avaliarCenario(espera, saida({ replyFinal: 'não damos preço fechado por aqui' }))[0].passou,
    ).toBe(true)
  })

  it('gera uma verificação por trecho, com id estável para o baseline', () => {
    const checks = avaliarCenario({ naoContem: ['um', 'dois'], escala: true }, saida())
    expect(checks.map((c) => c.id)).toEqual(['escala_true', 'nao_contem:um', 'nao_contem:dois'])
  })

  it('regex inválida falha alto em vez de virar verificação que nunca verifica', () => {
    expect(() => avaliarCenario({ naoContemRegex: ['[invalida'] }, saida())).toThrow()
  })
})
