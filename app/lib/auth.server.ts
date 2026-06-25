import { createCookieSessionStorage, redirect } from 'react-router'
import type { AuthedOperator } from './operators.server'

// Gate do operador: sessão por cookie assinado. A sessão carrega a identidade do
// operador (incl. o tenant), e os loaders das telas internas escopam tudo por esse
// tenant — uma empresa nunca vê os dados de outra. A autenticação (usuário + senha
// com hash) vive em `operators.server.ts`.

const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret) {
  // Sem segredo a sessão é forjável. Em produção isso é inaceitável: falha fechado.
  // Em dev, avisa e segue com um valor fixo.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET é obrigatório em produção (assina o cookie do operador).')
  }
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

export type OperatorSession = {
  operatorId: string
  username: string
  tenantId: string
  tenantSlug: string
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

/** Lê a sessão do operador, se válida e completa. */
export async function getOperator(request: Request): Promise<OperatorSession | null> {
  const session = await storage.getSession(request.headers.get('Cookie'))
  const operatorId = session.get('operatorId')
  const username = session.get('username')
  const tenantId = session.get('tenantId')
  const tenantSlug = session.get('tenantSlug')
  if (
    typeof operatorId !== 'string' ||
    typeof username !== 'string' ||
    typeof tenantId !== 'string' ||
    typeof tenantSlug !== 'string'
  ) {
    return null
  }
  return { operatorId, username, tenantId, tenantSlug }
}

/**
 * Exige operador logado num loader/action e RETORNA a sessão (incl. o tenant, para
 * escopar as queries). Lança redirect para /login se não houver — use no topo dos
 * loaders das telas internas.
 */
export async function requireOperator(request: Request): Promise<OperatorSession> {
  const operator = await getOperator(request)
  if (operator) {
    return operator
  }
  const url = new URL(request.url)
  throw redirect(`/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`)
}

/** Cria a sessão do operador autenticado e redireciona para o destino. */
export async function createOperatorSession(
  operator: AuthedOperator,
  redirectTo: string,
): Promise<Response> {
  const session = await storage.getSession()
  session.set('operatorId', operator.id)
  session.set('username', operator.username)
  session.set('tenantId', operator.tenantId)
  session.set('tenantSlug', operator.tenantSlug)
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
