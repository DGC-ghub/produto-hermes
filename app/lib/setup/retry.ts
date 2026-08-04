// Retry de transação sob contenção de escrita. PURO em relação ao domínio: recebe uma
// função e a executa de novo quando — e SOMENTE quando — o erro é de contenção.
//
// Vive em módulo próprio para ser testável com contador de chamadas. Embutido em
// `version.server.ts` ele só era exercitado por acidente, através de funções que falhavam
// antes de chegar nele.

export const TENTATIVAS_MAXIMAS = 4

/**
 * É contenção de escrita — o único caso que justifica tentar de novo?
 *
 * No SQLite a escrita é serializada, e a contenção aparece de três formas:
 *  - `SQLITE_BUSY` — a escrita bateu num lock;
 *  - `database is locked` — o mesmo, na mensagem que o Prisma repassa;
 *  - `P2028` **de aquisição** ("Operation has timed out") — a transação não conseguiu nem
 *    começar dentro do `maxWait`, porque outra a segurava.
 *
 * ⚠️ `P2028` tem um segundo sentido, oposto: *"Transaction already closed"*. Esse não é
 * contenção, é erro de uso — a transação já acabou e alguém tentou usá-la. Insistir não
 * muda nada e ainda esconde o bug. Por isso o código sozinho não basta: a mensagem decide.
 *
 * Qualquer outro erro sobe na primeira tentativa.
 */
export function ehContencaoTransitoria(error: unknown): boolean {
  const texto = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (/transaction already closed|closed transaction/i.test(texto)) {
    return false
  }
  return /database is locked|SQLITE_BUSY|Operation has timed out/i.test(texto)
}

/**
 * Executa, re-tentando com espera crescente enquanto o erro for de contenção.
 *
 * Só é seguro porque todo corpo que passa por aqui é protegido por compare-and-swap: uma
 * tentativa que falhou não escreveu nada, e se outra venceu a corrida o CAS da seguinte
 * não casa — o erro vira conflito, que é a verdade, em vez de duplicar.
 */
export async function comRetry<T>(executar: () => Promise<T>): Promise<T> {
  let ultimoErro: unknown
  for (let tentativa = 0; tentativa < TENTATIVAS_MAXIMAS; tentativa += 1) {
    try {
      return await executar()
    } catch (error) {
      if (!ehContencaoTransitoria(error)) {
        throw error
      }
      ultimoErro = error
      // Esperar importa: re-tentar na hora quase não ajuda, porque o lock que derrubou
      // esta transação continua nas mãos de quem estava escrevendo.
      if (tentativa < TENTATIVAS_MAXIMAS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 80 * 2 ** tentativa))
      }
    }
  }
  throw ultimoErro
}
