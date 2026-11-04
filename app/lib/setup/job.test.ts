import { describe, expect, it } from 'vitest'
import {
  decidirDesfecho,
  ERRO_MAX_CHARS,
  type FailureKind,
  MAX_ATTEMPTS,
  proximaTentativaEm,
  sanitizarErro,
  workerHabilitado,
} from './job'

// As decisões da fila, testadas como tabela. O que depende do banco (claim atômico, lease,
// heartbeat) está em job.server.test.ts — aqui não há relógio nem I/O, então o resultado
// não depende de carga da máquina.

describe('taxonomia de falhas (spec §6.4)', () => {
  const casos: Array<[FailureKind, number, 'retry_wait' | 'failed', boolean]> = [
    // kind,             tentativa, status,        alarma?
    ['transient', 1, 'retry_wait', false],
    ['transient', 2, 'retry_wait', false],
    ['invalid_output', 1, 'retry_wait', false],
    ['invalid_output', 2, 'retry_wait', false],
    // Na última tentativa acaba, e aí sim chama alguém: transitório três vezes seguidas
    // já não parece transitório.
    ['transient', MAX_ATTEMPTS, 'failed', true],
    ['invalid_output', MAX_ATTEMPTS, 'failed', true],
    // Insistir daria o mesmo resultado.
    ['terminal', 1, 'failed', true],
    // O sistema funcionando: a geração mudou no meio, este job não serve mais.
    ['superseded', 1, 'failed', false],
  ]

  it.each(casos)('%s na tentativa %i → %s (alarme: %s)', (kind, attempts, status, alarmar) => {
    expect(decidirDesfecho(kind, attempts)).toEqual({ status, alarmar })
  })

  it('obsoleto NÃO alarma nem na última tentativa', () => {
    // Alarme em coisa esperada vira ruído, e ruído é o que faz alarme de verdade passar
    // despercebido.
    expect(decidirDesfecho('superseded', MAX_ATTEMPTS).alarmar).toBe(false)
  })

  it('terminal não espera para tentar de novo', () => {
    expect(decidirDesfecho('terminal', 1).status).toBe('failed')
  })
})

describe('backoff (spec §6.5)', () => {
  const agora = new Date('2026-08-04T12:00:00Z')

  it.each([
    [1, 60_000],
    [2, 120_000],
    [3, 240_000],
  ])('tentativa %i espera %i ms', (attempts, esperado) => {
    expect(proximaTentativaEm(attempts, agora).getTime() - agora.getTime()).toBe(esperado)
  })

  it('a espera cresce a cada tentativa', () => {
    // Sem crescer, uma indisponibilidade de dez segundos do provider queimaria as três
    // tentativas em três segundos e o job morreria por nada.
    const esperas = [1, 2, 3].map((n) => proximaTentativaEm(n, agora).getTime())
    expect(esperas[1] - esperas[0]).toBeLessThan(esperas[2] - esperas[1])
  })

  it('nunca agenda para o passado', () => {
    for (const attempts of [0, 1, 2, 3, 10]) {
      expect(proximaTentativaEm(attempts, agora).getTime()).toBeGreaterThan(agora.getTime())
    }
  })
})

describe('sanitização do erro guardado', () => {
  it('guarda só a primeira linha', () => {
    // O stack e o corpo do erro de um job de agentes trazem pedaço do prompt e da saída —
    // ou seja, as respostas da empresa. Isso não entra no banco de fila.
    const erro = new Error('falhou ao parsear\n{"empresa":"Clínica X","segredo":"..."}')
    expect(sanitizarErro(erro)).toBe('falhou ao parsear')
  })

  it('colapsa espaços e quebras', () => {
    expect(sanitizarErro(new Error('  erro    com   espaços  '))).toBe('erro com espaços')
  })

  it('trunca e marca que truncou', () => {
    const resultado = sanitizarErro(new Error('x'.repeat(500)))
    expect(resultado.length).toBe(ERRO_MAX_CHARS + 1) // + o caractere de reticências
    expect(resultado.endsWith('…')).toBe(true)
  })

  it('aceita string solta e valor estranho sem quebrar', () => {
    expect(sanitizarErro('deu ruim')).toBe('deu ruim')
    expect(sanitizarErro(null)).toBe('null')
    expect(sanitizarErro(undefined)).toBe('undefined')
  })

  it('erro sem mensagem vira texto explícito, não vazio', () => {
    // Campo vazio no banco já escondeu erro antes: parece "sem erro".
    expect(sanitizarErro(new Error(''))).toBe('erro sem mensagem')
    expect(sanitizarErro('   ')).toBe('erro sem mensagem')
  })
})

describe('o worker é DESLIGADO por padrão (spec §6.2)', () => {
  it('sem a variável, desligado', () => {
    // Ligar sozinho faria um job de minutos disputar a vez com mensagem de cliente real,
    // que é sequencial e cairia no fallback.
    expect(workerHabilitado({})).toBe(false)
  })

  it.each([
    ['0'],
    [''],
    ['true'],
    ['sim'],
    ['yes'],
    ['1 '],
  ])('SETUP_WORKER_ENABLED=%j continua desligado', (valor) => {
    expect(workerHabilitado({ SETUP_WORKER_ENABLED: valor })).toBe(false)
  })

  it('só o "1" exato liga', () => {
    expect(workerHabilitado({ SETUP_WORKER_ENABLED: '1' })).toBe(true)
  })
})
