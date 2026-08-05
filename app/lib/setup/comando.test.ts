import { describe, expect, it } from 'vitest'
import { descreverModo, FLAGS_DE_SIMULACAO, interpretarArgumentos } from './comando'

// O contrato do `--sim` tem teste porque neste repositório o mesmo flag significa coisas
// opostas em dois comandos do prefixo `setup:` — lá ele APLICA, aqui ele não toca em nada.
// Uma inversão silenciosa faria um comando escrever achando que simula.

describe('--sim significa NÃO reivindicar e NÃO escrever', () => {
  it.each(FLAGS_DE_SIMULACAO.map((f) => [f]))('%s pede simulação', (flag) => {
    expect(interpretarArgumentos([flag])).toEqual({ tipo: 'simular' })
  })

  it('simulação VENCE o --falso: combinar os dois é engano', () => {
    // Quem digitou `--sim` está pedindo para não mexer em nada. Na dúvida, não toca.
    expect(interpretarArgumentos(['--falso', '--sim'])).toEqual({ tipo: 'simular' })
    expect(interpretarArgumentos(['--sim', '--falso'])).toEqual({ tipo: 'simular' })
  })

  it('ordem e vizinhança não mudam nada', () => {
    expect(interpretarArgumentos(['--verbose', '--sim', 'outro'])).toEqual({ tipo: 'simular' })
  })
})

describe('os outros modos', () => {
  it('--falso executa com o gerador de mentira', () => {
    expect(interpretarArgumentos(['--falso'])).toEqual({ tipo: 'executar_falso' })
  })

  it('sem flag nenhum, execução real', () => {
    expect(interpretarArgumentos([])).toEqual({ tipo: 'executar_real' })
  })

  it('flag desconhecido NÃO liga simulação por acidente', () => {
    // O perigo é o inverso do esperado: um typo virar "não faz nada" esconderia que o
    // comando não rodou. Argumento que não conhecemos cai no modo declarado, que é o real.
    expect(interpretarArgumentos(['--simulacao'])).toEqual({ tipo: 'executar_real' })
    expect(interpretarArgumentos(['--s'])).toEqual({ tipo: 'executar_real' })
  })
})

describe('o modo é anunciado', () => {
  it('a simulação diz que não altera nada', () => {
    expect(descreverModo({ tipo: 'simular' })).toContain('nada será reivindicado')
  })

  it.each([['executar_falso'], ['executar_real']] as const)('%s avisa que vai alterar', (tipo) => {
    const texto = descreverModo({ tipo })
    expect(texto).toContain('⚠️')
    expect(texto).toContain('reivindicar')
  })

  it('o falso diz que o artefato é de mentira', () => {
    // Sem isto alguém aprova uma candidata gerada pelo processador falso.
    expect(descreverModo({ tipo: 'executar_falso' })).toContain('FALSO')
  })
})
