import { Form, redirect, useActionData } from 'react-router'
import { Logo, WingMark } from '../components/brand/BrandMark'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'
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
    <main className="flex min-h-screen">
      <aside className="hidden w-1/2 flex-col justify-between bg-brand-deep p-10 text-white md:flex">
        <div className="flex items-center gap-2">
          <WingMark accent className="size-7 text-white" />
          <span className="font-display text-xl font-bold tracking-tight">Hermes</span>
        </div>
        <div>
          <p className="font-display text-3xl font-bold leading-tight">Cada conversa, lembrada.</p>
          <p className="mt-3 text-sm text-white/70">O painel do seu atendimento, num lugar só.</p>
        </div>
        <p className="text-xs text-white/40">Acesso restrito ao time. Cada empresa vê só a sua.</p>
      </aside>

      <div className="flex w-full items-center justify-center p-6 md:w-1/2">
        <div className="w-full max-w-sm space-y-6">
          <div className="md:hidden">
            <Logo />
          </div>
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-bold tracking-tight">Entrar</h1>
            <p className="text-sm text-ink-soft">Acesse o painel da sua empresa.</p>
          </div>

          <Form method="post" className="space-y-4">
            <input type="hidden" name="redirectTo" value={loaderData.redirectTo} />
            <TextField
              label="Usuário"
              type="text"
              name="username"
              required
              autoComplete="username"
              placeholder="a sua empresa"
            />
            <TextField
              label="Senha"
              type="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
            />
            {actionData?.error && <p className="text-sm text-urgent">{actionData.error}</p>}
            <Button type="submit" variant="primary" className="w-full">
              Entrar
            </Button>
          </Form>
        </div>
      </div>
    </main>
  )
}
