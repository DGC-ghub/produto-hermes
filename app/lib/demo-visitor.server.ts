import { createCookie } from 'react-router'
import { checkRate, type RateResult, type RateState } from './rate-limit'

// Identidade ANÔNIMA do visitante da demo pública (/demo/chat). Não há login aqui,
// então é este cookie assinado que separa "a minha conversa" da "conversa do outro":
// o visitante não escolhe quem é e não consegue forjar outro id (assinatura + formato
// de UUID). Antes disso a demo listava as conversas de todo mundo — incluindo contatos
// com número de telefone real — e aceitava o contactId vindo do formulário.

const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret && process.env.NODE_ENV === 'production') {
  // Sem segredo o cookie é forjável — e o isolamento entre visitantes some junto.
  throw new Error('SESSION_SECRET é obrigatório em produção (assina o cookie da demo).')
}

const VISITOR_MAX_AGE_SEC = 60 * 60 * 24 * 30 // 30 dias: o visitante volta e acha a conversa

export const demoVisitorCookie = createCookie('hermes_demo_visitor', {
  httpOnly: true,
  path: '/',
  sameSite: 'lax',
  secrets: [sessionSecret ?? 'dev-insecure-secret-change-me'],
  secure: process.env.NODE_ENV === 'production',
  maxAge: VISITOR_MAX_AGE_SEC,
})

const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** O valor lido do cookie tem a cara do que a gente emite (UUID)? Pura. */
export function isVisitorId(value: unknown): value is string {
  return typeof value === 'string' && VISITOR_ID.test(value)
}

/** contactId da demo = a identidade do cookie. NUNCA vem do formulário. Pura. */
export function demoContactId(visitorId: string): string {
  return `demo-${visitorId}`
}

export type DemoVisitor = {
  visitorId: string
  /** Cabeçalho Set-Cookie a devolver quando a identidade acabou de ser criada. */
  setCookie: string | null
}

/**
 * Lê a identidade do visitante do cookie assinado; se não houver (ou vier adulterada),
 * cria uma nova e devolve o Set-Cookie para o chamador anexar na resposta.
 */
export async function readDemoVisitor(request: Request): Promise<DemoVisitor> {
  const parsed = await demoVisitorCookie.parse(request.headers.get('Cookie'))
  if (isVisitorId(parsed)) {
    return { visitorId: parsed, setCookie: null }
  }
  const visitorId = crypto.randomUUID()
  return { visitorId, setCookie: await demoVisitorCookie.serialize(visitorId) }
}

// ── Teto da mensagem ────────────────────────────────────────────────────────
// Um textão não deixa a resposta melhor, só faz o cérebro (e o custo por token)
// crescer sem limite. Corta antes de processar.
export const DEMO_MESSAGE_MAX_CHARS = 2000

/** Corta a mensagem no teto da demo. Pura. */
export function truncateDemoMessage(message: string): string {
  return message.length > DEMO_MESSAGE_MAX_CHARS
    ? message.slice(0, DEMO_MESSAGE_MAX_CHARS)
    : message
}

// ── Teto POR VISITANTE ──────────────────────────────────────────────────────
// O teto global sozinho é injusto: um visitante entusiasmado consumia a cota de
// todos os outros (mesmo problema que o login já tinha). Aqui cada cookie tem o
// próprio orçamento; o teto global fica só como fusível da máquina.
export const DEMO_MAX_PER_VISITOR = 10
export const DEMO_VISITOR_WINDOW_MS = 60 * 60 * 1000 // 1 hora
const MAX_TRACKED_VISITORS = 5000

/**
 * Consome uma mensagem do orçamento do visitante e diz se pode seguir. O mapa é do
 * chamador (vive no módulo da rota, some no restart) e é atualizado aqui.
 */
export function checkVisitorQuota(
  now: number,
  states: Map<string, RateState>,
  visitorId: string,
): RateResult {
  // Teto de memória: cookies descartados de bots não fazem o mapa crescer pra sempre.
  if (states.size >= MAX_TRACKED_VISITORS && !states.has(visitorId)) {
    states.clear()
  }
  const current = states.get(visitorId) ?? { windowStart: 0, count: 0 }
  const result = checkRate(now, current, DEMO_MAX_PER_VISITOR, DEMO_VISITOR_WINDOW_MS)
  states.set(visitorId, result.state)
  return result
}
