import { describe, expect, it } from 'vitest'
import { comRetry, ehContencaoTransitoria, TENTATIVAS_MAXIMAS } from './retry'

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
