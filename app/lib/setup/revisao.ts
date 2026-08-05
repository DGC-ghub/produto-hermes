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

/** Os artefatos que o job precisa ter deixado prontos antes de alguém revisar (§6.1). */
export const CAMPOS_DE_ARTEFATO = [
  'candidateConfigJson',
  'candidateKnowledgeJson',
  'summaryJson',
  'gapsJson',
  'risksJson',
  'validationJson',
] as const

export type CampoDeArtefato = (typeof CAMPOS_DE_ARTEFATO)[number]

export type VersaoComArtefatos = Partial<Record<CampoDeArtefato, string | null>>

/**
 * Quais artefatos faltam ou não servem.
 *
 * "Presentes e válidos" (§11.1) é mais que "não-nulo": um `candidateConfigJson` com JSON
 * quebrado, ou um `validationJson` vazio, faria a pessoa assumir uma revisão sem ter o que
 * revisar — e o relógio de 30 minutos passaria a medir espera, não trabalho.
 *
 * Devolve a lista do que está errado, não um booleano: quem está no terminal precisa saber
 * o que faltou para decidir se roda o job de novo ou se investiga.
 */
export function artefatosPendentes(versao: VersaoComArtefatos): CampoDeArtefato[] {
  const faltando: CampoDeArtefato[] = []
  for (const campo of CAMPOS_DE_ARTEFATO) {
    if (!artefatoServe(campo, versao[campo])) {
      faltando.push(campo)
    }
  }
  return faltando
}

/** Um artefato serve? Precisa existir, ser JSON e ter conteúdo do formato certo. */
function artefatoServe(campo: CampoDeArtefato, bruto: string | null | undefined): boolean {
  if (typeof bruto !== 'string' || bruto.trim().length === 0) {
    return false
  }
  let valor: unknown
  try {
    valor = JSON.parse(bruto)
  } catch {
    return false
  }

  // `gaps` e `risks` VAZIOS são resultados legítimos — significam "não encontrei nenhum".
  // Exigir conteúdo neles obrigaria o gerador a inventar problema.
  if (campo === 'gapsJson' || campo === 'risksJson') {
    return Array.isArray(valor)
  }
  // A validação é a prova que a revisão vai conferir: lista vazia é ausência de prova.
  if (campo === 'validationJson' || campo === 'candidateKnowledgeJson') {
    return Array.isArray(valor) && valor.length > 0
  }
  // Config e resumo: objeto com pelo menos um campo.
  return typeof valor === 'object' && valor !== null && Object.keys(valor).length > 0
}
