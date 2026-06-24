import { timingSafeEqual } from 'node:crypto'
import { createCookieSessionStorage, redirect } from 'react-router'

// Gate do operador (MVP): protege as telas internas (/atendente, /dashboard) de
// acesso anônimo. NÃO é auth multi-usuário/multi-tenant ainda — é uma senha única
// de operador. O isolamento por tenant do operador (cada empresa só vê o seu) é a
// próxima fase, quando existir um modelo de usuário. Server-side (usa env/cookie).

const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret) {
  // Sem segredo a sessão não é confiável; avisamos alto e usamos um valor de dev.
  console.warn('[auth] SESSION_SECRET ausente — usando segredo de dev. Defina em produção.')
}

const storage = createCookieSessionStorage({
  cookie: {
    name: 'hermes_operator',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secrets: [sessionSecret ?? 'dev-insecure-secret-change-me'],
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8, // 8h
  },
})

// Comparação em tempo constante: evita timing attack ao conferir a senha.
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/**
 * Confere a senha do operador contra OPERATOR_PASSWORD. Fail-closed: se a env não
 * estiver definida, NINGUÉM entra (em vez de abrir sem senha). Função testável.
 */
export function checkOperatorPassword(password: string): boolean {
  const expected = process.env.OPERATOR_PASSWORD
  if (!expected) {
    return false
  }
  return constantTimeEqual(password, expected)
}

/**
 * Normaliza um destino de redirect para evitar open redirect: só aceita caminhos
 * internos (começam com "/" e não com "//"). Função pura, testável.
 */
export function safeRedirect(to: string | null | undefined, fallback = '/atendente'): string {
  if (!to?.startsWith('/') || to.startsWith('//')) {
    return fallback
  }
  return to
}

/** True se a requisição traz uma sessão de operador válida. */
export async function isOperator(request: Request): Promise<boolean> {
  const session = await storage.getSession(request.headers.get('Cookie'))
  return session.get('operator') === true
}

/**
 * Exige operador logado num loader/action. Se não houver sessão, LANÇA um redirect
 * para /login (preservando o destino). Use no topo de loaders de telas internas.
 */
export async function requireOperator(request: Request): Promise<void> {
  if (await isOperator(request)) {
    return
  }
  const url = new URL(request.url)
  throw redirect(`/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`)
}

/** Cria a sessão do operador e redireciona para o destino (já normalizado). */
export async function createOperatorSession(redirectTo: string): Promise<Response> {
  const session = await storage.getSession()
  session.set('operator', true)
  return redirect(redirectTo, {
    headers: { 'Set-Cookie': await storage.commitSession(session) },
  })
}

/** Encerra a sessão do operador e volta para /login. */
export async function logoutOperator(request: Request): Promise<Response> {
  const session = await storage.getSession(request.headers.get('Cookie'))
  return redirect('/login', {
    headers: { 'Set-Cookie': await storage.destroySession(session) },
  })
}
