// Retry de transação sob contenção de escrita. PURO em relação ao domínio: recebe uma
// função e a executa de novo quando — e SOMENTE quando — o erro é de contenção.
//
// Vive em módulo próprio para ser testável com contador de chamadas. Embutido em
// `version.server.ts` ele só era exercitado por acidente, através de funções que falhavam
// antes de chegar nele.

export const TENTATIVAS_MAXIMAS = 4

/**
 * Opções das transações interativas do setup.
 *
 * `maxWait` é quanto se espera para COMEÇAR (é onde a contenção aparece) e `timeout` é
 * quanto a transação pode rodar depois de começar. Os dois estavam em 20 s, o que dava um
 * teto de ~80 s somando as re-tentativas — inaceitável num POST interativo: ninguém espera
 * oitenta segundos por um autosave, e o navegador desiste bem antes.
 *
 * Com 5 s o orçamento TOTAL de espera continua o mesmo (4 × 5 s ≈ 20 s), só que fatiado:
 * mesma resiliência, teto quatro vezes menor. O `timeout` maior é para o corpo, que faz
 * duas ou três escritas e nunca deveria chegar perto disso.
 */
export const OPCOES_TRANSACAO = { maxWait: 5_000, timeout: 10_000 } as const

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
