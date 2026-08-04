// Retry de transação sob contenção de escrita. PURO em relação ao domínio: recebe uma
// função e a executa de novo quando — e SOMENTE quando — o erro é de contenção.
//
// Vive em módulo próprio para ser testável com contador de chamadas. Embutido em
// `version.server.ts` ele só era exercitado por acidente, através de funções que falhavam
// antes de chegar nele.

export const TENTATIVAS_MAXIMAS = 4

/**
 * Teto de relógio: o pior caso que um POST interativo pode custar, do primeiro tento até
 * desistir. É ELE que importa, não o número de tentativas.
 *
 * A conta "tentativas × timeout" engana. Com 4 tentativas de 20 s o teto era ~80 s, e
 * ninguém espera oitenta segundos por um autosave. Cortar os 20 s pela metade parecia
 * resolver e só trocou o problema de lugar: passou a derrubar transação que tinha
 * começado e estava esperando o lock — foi assim que a suíte completa ficou vermelha.
 *
 * Com orçamento explícito dá para ter as duas coisas: cada tentativa recebe o tempo de
 * antes, e o total continua limitado.
 */
export const ORCAMENTO_MS = 30_000

/**
 * Abaixo disto não há o que orçar: `maxWait` e `timeout` são sequenciais e cada um precisa
 * de pelo menos 1 ms. Orçamento menor é erro de chamada, não caso de uso.
 */
export const ORCAMENTO_MINIMO_MS = 2

/** Espera para COMEÇAR a transação. Não conseguir começar é barato de re-tentar. */
const MAXWAIT_BASE = 5_000

/**
 * Quanto a transação pode levar DEPOIS de começar. Precisa ser generoso: o corpo faz duas
 * ou três escritas, mas entre elas pode ficar parado esperando o lock de escrita do SQLite,
 * que é serializado entre todos os tenants.
 */
const TIMEOUT_BASE = 20_000

export type OpcoesTransacao = { maxWait: number; timeout: number }

/**
 * É contenção de escrita — o único caso que justifica tentar de novo?
 *
 * No SQLite a escrita é serializada, e a contenção aparece de três formas:
 *  - `SQLITE_BUSY` — a escrita bateu num lock;
 *  - `database is locked` — o mesmo, na mensagem que o Prisma repassa;
 *  - `P2028` **de aquisição** — a transação não conseguiu nem começar dentro do `maxWait`
 *    porque outra a segurava ("Operation has timed out" / "Unable to start a transaction
 *    in the given time").
 *
 * ⚠️ `P2028` também cobre o sentido OPOSTO — *"Transaction already closed"*, *"expired
 * transaction"* —, que é a transação que já começou e morreu. Aí insistir não muda nada,
 * esconde o bug de uso e, pior, a tentativa anterior pode ter escrito. Por isso o código
 * sozinho não basta.
 *
 * E a mensagem sozinha também não: *"timed out"* aparece em erro de socket, de fetch, de
 * qualquer biblioteca. Sem exigir o código do Prisma, um timeout de outra origem seria
 * repetido quatro vezes antes de aparecer. Só a dupla (código + redação) identifica a
 * aquisição. Qualquer outro erro sobe na primeira tentativa.
 */
export function ehContencaoTransitoria(error: unknown): boolean {
  const texto = error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  // Transação que já morreu: permanente, mesmo que a redação também case lá embaixo.
  if (/transaction already closed|closed transaction|expired transaction/i.test(texto)) {
    return false
  }

  // Lock do próprio SQLite: a mensagem basta — vem de baixo do Prisma e não traz código.
  if (/database is locked|SQLITE_BUSY/i.test(texto)) {
    return true
  }

  const code = (error as { code?: unknown } | null | undefined)?.code
  return (
    code === 'P2028' &&
    /Operation has timed out|Unable to start a transaction in the given time/i.test(texto)
  )
}

/**
 * Executa, re-tentando com espera crescente enquanto o erro for de contenção.
 *
 * Só é seguro porque todo corpo que passa por aqui é protegido por compare-and-swap: uma
 * tentativa que falhou não escreveu nada, e se outra venceu a corrida o CAS da seguinte
 * não casa — o erro vira conflito, que é a verdade, em vez de duplicar.
 */
export async function comRetry<T>(
  executar: (opcoes: OpcoesTransacao) => Promise<T>,
  orcamentoMs: number = ORCAMENTO_MS,
): Promise<T> {
  // Orçamento que não dá para dividir entre as duas fases não é orçamento apertado, é
  // chamada errada. Rodar uma tentativa de 1 ms "para tentar" só produz erro confuso.
  if (!Number.isFinite(orcamentoMs) || orcamentoMs < ORCAMENTO_MINIMO_MS) {
    throw new Error(
      `Orçamento inválido para comRetry: ${orcamentoMs}ms (mínimo ${ORCAMENTO_MINIMO_MS}ms)`,
    )
  }

  // Relógio MONOTÔNICO: `Date.now()` anda para trás com ajuste de NTP, e aí o "restante"
  // aumenta sozinho — justamente o que o teto não pode permitir.
  const inicio = performance.now()
  const restante = () => orcamentoMs - (performance.now() - inicio)
  let ultimoErro: unknown

  for (let tentativa = 0; tentativa < TENTATIVAS_MAXIMAS; tentativa += 1) {
    const sobra = restante()
    if (tentativa > 0 && sobra < ORCAMENTO_MINIMO_MS) {
      break
    }

    // As duas fases são SEQUENCIAIS — primeiro espera-se começar (`maxWait`), depois roda
    // (`timeout`) —, então quem manda é a SOMA. Dar o restante inteiro para cada uma
    // deixava o teto valer o dobro.
    const maxWait = Math.min(MAXWAIT_BASE, Math.floor(sobra / 2))
    const timeout = Math.min(TIMEOUT_BASE, Math.max(Math.floor(sobra) - maxWait, 1))

    try {
      return await executar({ maxWait, timeout })
    } catch (error) {
      if (!ehContencaoTransitoria(error)) {
        throw error
      }
      ultimoErro = error
      // Esperar importa: re-tentar na hora quase não ajuda, porque o lock que derrubou
      // esta transação continua nas mãos de quem estava escrevendo. Mas a espera sai do
      // MESMO orçamento — sem limitá-la, o backoff sozinho estourava o teto.
      if (tentativa < TENTATIVAS_MAXIMAS - 1) {
        const espera = Math.min(80 * 2 ** tentativa, Math.max(restante(), 0))
        if (espera > 0) {
          await new Promise((resolve) => setTimeout(resolve, espera))
        }
      }
    }
  }
  throw ultimoErro
}
