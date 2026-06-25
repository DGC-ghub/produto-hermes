import { Form, redirect, useActionData } from 'react-router'
import { createOperatorSession, getOperator, safeRedirect } from '../lib/auth.server'
import { authenticateOperator, ensureSeedOperators } from '../lib/operators.server'
import type { Route } from './+types/login'

export async function loader({ request }: Route.LoaderArgs) {
  // Garante os operadores demo (idempotente) para o piloto/local funcionar.
  await ensureSeedOperators()
  // Já logado: não faz sentido mostrar o login de novo.
  if (await getOperator(request)) {
    throw redirect('/atendente')
  }
  const url = new URL(request.url)
  return { redirectTo: safeRedirect(url.searchParams.get('redirectTo')) }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const username = String(formData.get('username') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const redirectTo = safeRedirect(String(formData.get('redirectTo') ?? ''))

  const operator = await authenticateOperator(username, password)
  if (!operator) {
    // Mensagem genérica: não revela se foi o usuário ou a senha.
    return { error: 'Usuário ou senha incorretos.' }
  }
  return createOperatorSession(operator, redirectTo)
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Hermes — Entrar' }]
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>()

  return (
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Hermes — área do operador</h1>
        <p className="text-sm text-gray-500">
          Acesso restrito ao time. Cada operador vê apenas a sua empresa.
        </p>
      </header>

      <Form method="post" className="space-y-3">
        <input type="hidden" name="redirectTo" value={loaderData.redirectTo} />
        <input
          type="text"
          name="username"
          required
          autoComplete="username"
          placeholder="Usuário (ex.: a empresa)"
          className="w-full rounded border border-gray-300 p-2 text-sm"
        />
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="Senha"
          className="w-full rounded border border-gray-300 p-2 text-sm"
        />
        {actionData?.error && <p className="text-sm text-red-600">{actionData.error}</p>}
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Entrar
        </button>
      </Form>
    </main>
  )
}
