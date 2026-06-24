import { Form, redirect, useActionData } from 'react-router'
import {
  checkOperatorPassword,
  createOperatorSession,
  isOperator,
  safeRedirect,
} from '../lib/auth.server'
import type { Route } from './+types/login'

export async function loader({ request }: Route.LoaderArgs) {
  // Já logado: não faz sentido mostrar o login de novo.
  if (await isOperator(request)) {
    throw redirect('/atendente')
  }
  const url = new URL(request.url)
  return { redirectTo: safeRedirect(url.searchParams.get('redirectTo')) }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const password = String(formData.get('password') ?? '')
  const redirectTo = safeRedirect(String(formData.get('redirectTo') ?? ''))

  if (!checkOperatorPassword(password)) {
    return { error: 'Senha incorreta.' }
  }
  return createOperatorSession(redirectTo)
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
          Acesso restrito ao time. Informe a senha do operador.
        </p>
      </header>

      <Form method="post" className="space-y-3">
        <input type="hidden" name="redirectTo" value={loaderData.redirectTo} />
        <input
          type="password"
          name="password"
          required
          placeholder="Senha do operador"
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
