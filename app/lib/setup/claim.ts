// O que fazer quando a criação do rascunho PERDE a corrida pelo ponteiro.
//
// Está separado, e puro, porque é decisão — e decisão se testa com uma tabela, não com um
// gancho global no módulo de produção. A corrida em si não é simulável no SQLite (de fora,
// nenhuma outra conexão escreve durante a transação interativa; de dentro, o rollback
// desfaz a própria interferência), mas o que se faz DEPOIS dela é justamente o que decide
// se a pessoa vê o rascunho de quem venceu, a configuração publicada, ou um erro.

/** O par de ponteiros do `AiSetup`, relido depois da perda. */
export type PonteiroDoSetup = {
  reviewVersionId: string | null
  publishedVersionId: string | null
}

export type ResolucaoAposPerda =
  /** Alguém abriu a revisão primeiro: é a versão dele que vale. */
  | { tipo: 'usar-review'; versionId: string }
  /** Não foi um rascunho que venceu, foi uma publicação — não há o que elaborar. */
  | { tipo: 'usar-publicada' }
  /** Ninguém venceu: perder o CAS sem ponteiro nenhum não deveria ser possível. */
  | { tipo: 'incoerente' }

/**
 * Quem venceu a corrida, lido pelos ponteiros.
 *
 * A ordem importa: a review vem primeiro. Um tenant pode ter os dois (configuração no ar
 * + correção em elaboração) e, nesse caso, o que a tela precisa mostrar é a correção.
 *
 * `incoerente` não é paranoia: o CAS exige `reviewVersionId: null` E `publishedVersionId:
 * null`, então perder significa que um dos dois foi preenchido. Se nenhum foi, o que
 * derrubou a tentativa não foi concorrência — e seguir adiante chutando esconderia isso.
 */
export function resolverAposPerderCas(ponteiro: PonteiroDoSetup): ResolucaoAposPerda {
  if (ponteiro.reviewVersionId) {
    return { tipo: 'usar-review', versionId: ponteiro.reviewVersionId }
  }
  if (ponteiro.publishedVersionId) {
    return { tipo: 'usar-publicada' }
  }
  return { tipo: 'incoerente' }
}
