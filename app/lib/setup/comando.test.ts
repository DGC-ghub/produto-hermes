import { describe, expect, it } from 'vitest'
import {
  descreverModo,
  ehBancoDescartavel,
  FLAGS_DE_SIMULACAO,
  interpretarArgumentos,
} from './comando'

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

  it('a ordem entre flags conhecidos não muda nada', () => {
    expect(interpretarArgumentos(['--falso', '--dry-run'])).toEqual({ tipo: 'simular' })
    expect(interpretarArgumentos(['--simular', '--falso'])).toEqual({ tipo: 'simular' })
  })
})

describe('os outros modos', () => {
  it('--falso executa com o gerador de mentira', () => {
    expect(interpretarArgumentos(['--falso'])).toEqual({ tipo: 'executar_falso' })
  })

  it('sem flag nenhum, execução real', () => {
    expect(interpretarArgumentos([])).toEqual({ tipo: 'executar_real' })
  })

  it.each([
    ['--simulacao'],
    ['--s'],
    ['--fake'],
    ['-sim'],
    ['sim'],
  ])('argumento desconhecido (%s) PARA o comando', (arg) => {
    // Cair em "execução real" hoje é inofensivo só porque o gerador real não existe.
    // Quando ele entrar (etapa 6), o mesmo erro de digitação passaria a processar de
    // verdade — bomba-relógio, não garantia.
    expect(interpretarArgumentos([arg])).toEqual({ tipo: 'argumento_invalido', argumento: arg })
  })

  it('um desconhecido no meio de flags válidos também para', () => {
    expect(interpretarArgumentos(['--sim', '--xyz'])).toEqual({
      tipo: 'argumento_invalido',
      argumento: '--xyz',
    })
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

describe('banco descartável: onde o gerador de mentira pode escrever', () => {
  it.each([
    ['file:/tmp/hermes-teste.db'],
    ['file:/tmp/claude-1000/x/cmd.db'],
    ['file:/home/pi/projects/produto-hermes/.test-123-1.db'],
  ])('%s é descartável', (url) => {
    expect(ehBancoDescartavel(url)).toBe(true)
  })

  const proibidos: Array<[string, string | undefined]> = [
    // O caso que importa: no Pi o `dev.db` do repositório É o banco do serviço.
    ['dev.db do repositório', 'file:./dev.db'],
    ['dev.db por caminho absoluto', 'file:/home/pi/projects/produto-hermes/dev.db'],
    ['o banco do deploy', 'file:/home/pi/hermes-deploy/shared/dev.db'],
    // Nome parecido não basta: `/tmp` tem que ser diretório, não prefixo.
    ['diretório que só COMEÇA com tmp', 'file:/tmpfoo/x.db'],
    ['nome que contém .test no meio', 'file:/home/pi/prod.test.db'],
    ['url que não é sqlite', 'postgresql://host/db'],
    ['ausente', undefined],
    ['vazia', ''],
  ]

  it.each(proibidos)('%s NÃO é descartável', (_rotulo, url) => {
    // Na dúvida a resposta é "não": negar a mais custa um `export`, negar a menos custa
    // dado de cliente.
    expect(ehBancoDescartavel(url)).toBe(false)
  })
})
