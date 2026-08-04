import { describe, expect, it } from 'vitest'
import { comRetry, ehContencaoTransitoria, ORCAMENTO_MS, TENTATIVAS_MAXIMAS } from './retry'

// O retry existe por UM motivo: no SQLite a escrita é serializada, e sob concorrência a
// transação pode não conseguir nem começar. Insistir em qualquer outra coisa esconderia
// bug de lógica atrás de três tentativas.
//
// Estes testes contam CHAMADAS — o teste anterior chamava uma função que falhava antes de
// chegar ao retry, então não provava nada.

/** Erro no formato que o Prisma lança, com `code`. */
function erroPrisma(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/** Executa e conta quantas vezes o corpo foi chamado. */
async function contarTentativas(erro: unknown): Promise<number> {
  let chamadas = 0
  await comRetry(async () => {
    chamadas += 1
    throw erro
  }).catch(() => {})
  return chamadas
}

describe('classificação: o que é contenção e o que não é', () => {
  const transitorios: Array<[string, unknown]> = [
    ['SQLITE_BUSY', new Error('SQLITE_BUSY: database is busy')],
    ['database is locked', new Error('Invalid `prisma.x.updateMany()`: database is locked')],
    [
      'P2028 de aquisição (não conseguiu começar)',
      erroPrisma('P2028', 'Transaction API error: Operation has timed out'),
    ],
    [
      'P2028 de aquisição na outra redação do Prisma',
      erroPrisma('P2028', 'Unable to start a transaction in the given time.'),
    ],
  ]

  it.each(transitorios)('%s é transitório', (_label, erro) => {
    expect(ehContencaoTransitoria(erro)).toBe(true)
  })

  const permanentes: Array<[string, unknown]> = [
    // MESMO código P2028, sentido oposto: a transação já fechou — insistir não muda nada,
    // é erro de uso. Era o buraco do filtro por código puro.
    [
      'P2028 de transação já fechada',
      erroPrisma(
        'P2028',
        'Transaction already closed: A query cannot be executed on a closed transaction.',
      ),
    ],
    [
      // A transação COMEÇOU e estourou o `timeout`. Insistir na mesma transação morta não
      // adianta — e diferente da aquisição, aqui já pode ter havido escrita.
      'P2028 de transação expirada',
      erroPrisma('P2028', 'A query cannot be executed on an expired transaction.'),
    ],
    [
      // Sem o código do Prisma, "timed out" é só uma palavra: pode vir de fetch, de socket,
      // de qualquer biblioteca. Re-tentar três vezes esconderia o erro de verdade.
      'timeout de OUTRA origem (sem código P2028)',
      new Error('Operation has timed out'),
    ],
    ['timeout com código de outro erro', erroPrisma('P1008', 'Operation has timed out')],
    ['P2002 (violação de unique)', erroPrisma('P2002', 'Unique constraint failed')],
    ['P2025 (registro não encontrado)', erroPrisma('P2025', 'An operation failed')],
    ['erro genérico', new Error('deu ruim')],
    ['TypeError de bug real', new TypeError('x is not a function')],
    ['string solta', 'alguma coisa'],
    ['null', null],
  ]

  it.each(permanentes)('%s NÃO é transitório', (_label, erro) => {
    expect(ehContencaoTransitoria(erro)).toBe(false)
  })
})

describe('comRetry só insiste no que é transitório', () => {
  it('SQLITE_BUSY é tentado mais de uma vez', async () => {
    expect(await contarTentativas(new Error('SQLITE_BUSY'))).toBeGreaterThan(1)
  })

  it('database is locked é tentado mais de uma vez', async () => {
    expect(await contarTentativas(new Error('database is locked'))).toBeGreaterThan(1)
  })

  it('P2028 de aquisição é tentado mais de uma vez', async () => {
    const erro = erroPrisma('P2028', 'Operation has timed out')
    expect(await contarTentativas(erro)).toBeGreaterThan(1)
  })

  it('P2028 de transação já fechada é tentado UMA vez', async () => {
    const erro = erroPrisma('P2028', 'Transaction already closed')
    expect(await contarTentativas(erro)).toBe(1)
  })

  it('timeout sem o código P2028 é tentado UMA vez', async () => {
    expect(await contarTentativas(new Error('Operation has timed out'))).toBe(1)
  })

  it('P2002 é tentado UMA vez', async () => {
    expect(await contarTentativas(erroPrisma('P2002', 'Unique constraint failed'))).toBe(1)
  })

  it('erro genérico é tentado UMA vez', async () => {
    expect(await contarTentativas(new Error('deu ruim'))).toBe(1)
  })

  it('desiste depois do teto e propaga o último erro', async () => {
    const erro = new Error('database is locked')
    let chamadas = 0
    await expect(
      comRetry(async () => {
        chamadas += 1
        throw erro
      }),
    ).rejects.toBe(erro)
    expect(chamadas).toBe(TENTATIVAS_MAXIMAS)
  })

  it('para assim que dá certo', async () => {
    let chamadas = 0
    const resultado = await comRetry(async () => {
      chamadas += 1
      if (chamadas < 2) {
        throw new Error('database is locked')
      }
      return 'ok'
    })
    expect(resultado).toBe('ok')
    expect(chamadas).toBe(2)
  })

  it('sucesso de primeira não espera nada', async () => {
    const inicio = Date.now()
    await comRetry(async () => 'ok')
    expect(Date.now() - inicio).toBeLessThan(50)
  })

  it('erro permanente volta rápido — sem pagar backoff à toa', async () => {
    const inicio = Date.now()
    await comRetry(async () => {
      throw new Error('bug de lógica')
    }).catch(() => {})
    expect(Date.now() - inicio).toBeLessThan(50)
  })
})

describe('o teto é o orçamento de relógio, não tentativas × timeout', () => {
  it('a primeira tentativa recebe o tempo cheio', async () => {
    let recebido: { maxWait: number; timeout: number } | null = null
    await comRetry(async (opcoes) => {
      recebido = opcoes
      return 'ok'
    })
    // 20 s para a transação que JÁ começou: entre uma escrita e outra ela pode ficar
    // parada esperando o lock, e derrubá-la em 10 s foi o que pintou a suíte de vermelho.
    expect(recebido).toEqual({ maxWait: 5_000, timeout: 20_000 })
  })

  it('maxWait + timeout nunca passa do que resta — as duas fases são sequenciais', async () => {
    // Dar o restante INTEIRO para cada uma fazia o teto valer o dobro: espera-se para
    // começar e SÓ ENTÃO se roda, então quem manda é a soma.
    const inicio = performance.now()
    const somas: number[] = []
    await comRetry(async (opcoes) => {
      const sobra = 300 - (performance.now() - inicio)
      somas.push(opcoes.maxWait + opcoes.timeout - sobra)
      throw new Error('database is locked')
    }, 300).catch(() => {})

    expect(somas.length).toBeGreaterThan(1)
    for (const excesso of somas) {
      // 1 ms de folga é a deriva entre o relógio que o `comRetry` leu e o que o teste lê
      // um instante depois — o defeito que isto pega dobrava o orçamento, não arranhava.
      expect(excesso).toBeLessThanOrEqual(1)
    }
  })

  it('o backoff também sai do orçamento — o teto vale de ponta a ponta', async () => {
    // A medição que denunciou isto: orçamento de 300 ms terminando em ~580 ms, porque o
    // backoff (80 + 160 + 320 ms) não olhava o relógio.
    const inicio = performance.now()
    await comRetry(async () => {
      throw new Error('database is locked')
    }, 300).catch(() => {})
    const gasto = performance.now() - inicio

    // A folga cobre o atraso normal de timer; o que não pode é dobrar o orçamento.
    expect(gasto).toBeLessThan(300 + 150)
  })

  it('para de tentar quando o orçamento acaba, mesmo sobrando tentativas', async () => {
    let chamadas = 0
    const inicio = performance.now()
    await comRetry(async () => {
      chamadas += 1
      throw new Error('database is locked')
    }, 100).catch(() => {})

    expect(chamadas).toBeLessThan(TENTATIVAS_MAXIMAS)
    expect(performance.now() - inicio).toBeLessThan(100 + 150)
  })

  const invalidos: Array<[string, number]> = [
    ['zero', 0],
    ['negativo', -1_000],
    ['abaixo do mínimo', 1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ]

  it.each(invalidos)('orçamento %s recusa sem executar nada', async (_label, orcamento) => {
    let chamadas = 0
    await expect(
      comRetry(async () => {
        chamadas += 1
        return 'ok'
      }, orcamento),
    ).rejects.toThrow(/Orçamento inválido/)
    expect(chamadas).toBe(0)
  })

  it('o pior caso cabe num POST interativo', () => {
    // A conta antiga era `tentativas × timeout` = ~80 s. Ninguém espera oitenta segundos
    // por um autosave, e o navegador desiste antes.
    expect(ORCAMENTO_MS).toBeLessThanOrEqual(30_000)
  })
})
