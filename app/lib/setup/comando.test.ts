import { describe, expect, it } from 'vitest'
import {
  descreverModo,
  FLAGS_DE_SIMULACAO,
  interpretarArgumentos,
  interpretarArgumentosDeRevisao,
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

describe('argumentos do setup:revisar', () => {
  it('slug posicional e reviewer', () => {
    expect(interpretarArgumentosDeRevisao(['acme', '--reviewer', 'Gabriel'])).toEqual({
      tipo: 'revisar',
      slug: 'acme',
      reviewer: 'Gabriel',
      simular: false,
    })
  })

  it('a ordem entre o slug e a flag não importa', () => {
    expect(interpretarArgumentosDeRevisao(['--reviewer', 'Ana', 'acme'])).toMatchObject({
      slug: 'acme',
      reviewer: 'Ana',
    })
  })

  it.each(FLAGS_DE_SIMULACAO.map((f) => [f]))('%s liga a simulação', (flag) => {
    expect(interpretarArgumentosDeRevisao(['acme', '--reviewer', 'Ana', flag])).toMatchObject({
      tipo: 'revisar',
      simular: true,
    })
  })

  it('o nome do revisor não é confundido com slug nem com flag', () => {
    // `--reviewer --sim` pegaria "--sim" como nome se o parser não consumisse o valor.
    expect(interpretarArgumentosDeRevisao(['acme', '--reviewer', 'Ana Maria'])).toMatchObject({
      slug: 'acme',
      reviewer: 'Ana Maria',
    })
  })

  it('sem slug, para', () => {
    expect(interpretarArgumentosDeRevisao(['--reviewer', 'Ana'])).toEqual({ tipo: 'slug_ausente' })
  })

  it('DOIS slugs param o comando', () => {
    // Adivinhar qual empresa revisar é o pior desfecho possível aqui.
    expect(interpretarArgumentosDeRevisao(['acme', 'outra', '--reviewer', 'Ana'])).toEqual({
      tipo: 'slug_repetido',
      segundo: 'outra',
    })
  })

  it.each([['--falso'], ['--xyz'], ['-r']])('flag desconhecido (%s) para o comando', (arg) => {
    expect(interpretarArgumentosDeRevisao(['acme', arg])).toEqual({
      tipo: 'argumento_invalido',
      argumento: arg,
    })
  })

  it('reviewer ausente NÃO é decidido aqui', () => {
    // Quem valida o nome é `normalizarReviewer`: ele sabe distinguir "faltou" de "curto
    // demais", e é essa diferença que vira mensagem útil.
    expect(interpretarArgumentosDeRevisao(['acme'])).toMatchObject({
      tipo: 'revisar',
      reviewer: undefined,
    })
  })
})
