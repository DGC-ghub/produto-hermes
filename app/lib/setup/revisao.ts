// Regras de quem assume uma revisão interna. PURAS: sem banco, sem hostname, sem relógio.
//
// Referência: spec §11.1 (pré-condições do claim) e §11.2 (reviewer).

/** Mínimo de caracteres de um nome de revisor. Iniciais não identificam ninguém. */
export const REVIEWER_MIN_CHARS = 3

export type ReviewerLido =
  | { ok: true; nome: string }
  | { ok: false; motivo: 'ausente' | 'curto_demais' }

/**
 * Lê e normaliza o nome do revisor.
 *
 * É obrigatório porque o nome vai para a auditoria: "quem assumiu esta revisão" é a
 * pergunta que alguém faz meses depois, quando a configuração que atende cliente veio
 * daqui. Um campo vazio ou "ab" responderia nada.
 */
export function normalizarReviewer(bruto: string | undefined): ReviewerLido {
  const nome = (bruto ?? '').trim().replace(/\s+/g, ' ')
  if (nome.length === 0) {
    return { ok: false, motivo: 'ausente' }
  }
  if (nome.length < REVIEWER_MIN_CHARS) {
    return { ok: false, motivo: 'curto_demais' }
  }
  return { ok: true, nome }
}

/**
 * O `actor` que vai para o evento (§11.2).
 *
 * Leva o hostname junto porque "joao" em duas máquinas são duas pessoas diferentes na
 * prática, e a auditoria precisa distinguir de onde a decisão saiu.
 */
export function formatarAtor(reviewer: string, hostname: string): string {
  return `internal:${reviewer}@${hostname}`
}
