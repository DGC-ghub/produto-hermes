/**
 * Helpers puros da camada de UI (testáveis sem DOM). Os componentes em
 * `app/components/ui/` consomem estas funções; a lógica fica aqui para os
 * testes rodarem no ambiente `node` do Vitest.
 */

/** Junta classes condicionais, ignorando valores falsy. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** Iniciais de um nome (1–2 letras maiúsculas) para avatares. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return '?'
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = ['bg-brand', 'bg-brand-deep', 'bg-ai', 'bg-waiting'] as const

/** Cor de avatar determinística a partir de um seed (nome ou id). */
export function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

/**
 * Taxa de autonomia: % de conversas resolvidas sem envolver um humano. Devolve
 * `null` quando ainda não há conversas (evita 0/0 e um "0%" enganoso no painel).
 * Função pura.
 */
export function autonomyPercent(total: number, humanInvolved: number): number | null {
  if (total <= 0) {
    return null
  }
  return Math.round(((total - humanInvolved) / total) * 100)
}

export type AutonomyTone = 'good' | 'fair' | 'poor' | 'empty'

// Limiares da taxa de autonomia. A cor é MERECIDA: verde só quando a IA está de
// fato resolvendo sozinha. Abaixo disso é âmbar/neutro — nunca pintar 0% de verde.
export const AUTONOMY_GOOD = 70
export const AUTONOMY_FAIR = 40

/**
 * Classifica a taxa de autonomia em um tom semântico (por VALOR, não fixo).
 * `null` (sem conversas ainda) vira 'empty'. Função pura.
 */
export function autonomyTone(autonomy: number | null): AutonomyTone {
  if (autonomy === null) {
    return 'empty'
  }
  if (autonomy >= AUTONOMY_GOOD) {
    return 'good'
  }
  if (autonomy >= AUTONOMY_FAIR) {
    return 'fair'
  }
  return 'poor'
}

/** Classe de cor do texto para cada tom de autonomia. */
export const AUTONOMY_TONE_CLASS: Record<AutonomyTone, string> = {
  good: 'text-brand',
  fair: 'text-waiting',
  poor: 'text-ink',
  empty: 'text-ink-soft',
}

export type AttendStatus = 'urgent' | 'waiting' | 'resolved' | 'ai'

/** Rótulo + classe do ponto para cada status do atendimento. */
export function statusMeta(status: AttendStatus): { label: string; dot: string } {
  switch (status) {
    case 'urgent':
      return { label: 'precisa de humano', dot: 'bg-urgent' }
    case 'waiting':
      return { label: 'aguardando', dot: 'bg-waiting' }
    case 'resolved':
      return { label: 'resolvido', dot: 'bg-brand' }
    case 'ai':
      return { label: 'IA no ar', dot: 'bg-ai' }
  }
}

/**
 * Traduz o status CRU de uma conversa (string do banco) para um rótulo legível +
 * ponto colorido, seguindo a regra "ponto + texto, nunca bloco de cor". Cobre o
 * ciclo open → needs_human → human → closed e os apelidos legados. Função pura.
 */
export function conversationStatusMeta(status: string): { label: string; dot: string } {
  switch (status) {
    case 'needs_human':
      return { label: 'precisa de humano', dot: 'bg-urgent' }
    case 'human':
    case 'human_handling':
      return { label: 'em atendimento', dot: 'bg-waiting' }
    case 'closed':
    case 'resolved':
    case 'resolvido':
      return { label: 'encerrado', dot: 'bg-brand' }
    case 'open':
    case 'aberto':
    case 'em_andamento':
      return { label: 'IA no ar', dot: 'bg-ai' }
    default:
      return { label: status, dot: 'bg-ink-soft' }
  }
}
