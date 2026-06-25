// Dedup de chamados: o atendente IA pode propor "abrir_chamado" em mensagens
// seguidas sobre o MESMO problema (ex.: o cliente reforça "cadê o técnico?"). O
// balcão não deve criar um chamado novo pra cada reforço — mas DEVE permitir
// chamados distintos pra problemas distintos (geladeira vs. máquina de lavar).
// A decisão é por similaridade de assunto, determinística (sem LLM). Função pura.

const STOPWORDS = new Set([
  // conectivos / genéricos
  'para',
  'pelo',
  'pela',
  'com',
  'sem',
  'que',
  'uma',
  'meu',
  'minha',
  'esta',
  'este',
  'urgente',
  // boilerplate de "abrir chamado" e cordialidade: não identificam o PROBLEMA,
  // então não devem fazer dois chamados distintos parecerem o mesmo.
  'abrir',
  'chamado',
  'chamados',
  'solicitar',
  'solicitacao',
  'reclamacao',
  'quero',
  'favor',
  'gostaria',
  'poderia',
  'pode',
  'preciso',
])

const SIMILARITY_THRESHOLD = 0.5

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

// Tokens "de conteúdo": palavras com 4+ caracteres que não são stopwords. Curtas
// e genéricas (de/do/com/urgente) não ajudam a distinguir um problema do outro.
function contentTokens(subject: string): Set<string> {
  return new Set(
    normalize(subject)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token)),
  )
}

/**
 * Dois assuntos descrevem o mesmo problema? True se forem iguais (normalizados)
 * ou se a sobreposição de tokens de conteúdo atingir o limiar (sobre o menor
 * conjunto, para não punir um assunto mais curto). Pura e determinística.
 */
export function subjectsAreSimilar(a: string, b: string): boolean {
  if (normalize(a) === normalize(b)) {
    return true
  }
  const ta = contentTokens(a)
  const tb = contentTokens(b)
  if (ta.size === 0 || tb.size === 0) {
    return false
  }
  let common = 0
  for (const token of ta) {
    if (tb.has(token)) {
      common += 1
    }
  }
  return common / Math.min(ta.size, tb.size) >= SIMILARITY_THRESHOLD
}

/**
 * Já existe um chamado aberto que cobre este assunto? Recebe os assuntos dos
 * chamados em aberto do contato. Pura — o balcão decide criar ou não a partir daqui.
 */
export function hasDuplicateOpenTicket(newSubject: string, openSubjects: string[]): boolean {
  return openSubjects.some((subject) => subjectsAreSimilar(newSubject, subject))
}

// Estados válidos de um chamado (o atendente muda na tela /atendente).
export const TICKET_STATUSES = ['aberto', 'em_andamento', 'resolvido'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value)
}
