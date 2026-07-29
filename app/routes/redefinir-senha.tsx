import { Form, Link, useActionData, useNavigation } from 'react-router'
import { Logo, WingMark } from '../components/brand/BrandMark'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'
import { accountForResetToken, completePasswordReset } from '../lib/password-reset.server'
import type { Route } from './+types/redefinir-senha'

// Destino do link enviado por e-mail. Rota PÚBLICA: o dono da conta chega aqui deslogado. O
// token do link é a credencial (assinado + com prazo, ver password-reset.server.ts) e para de
// valer sozinho assim que a senha muda.

export async function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  // Confere o link ANTES de mostrar o formulário: melhor dizer "peça outro" agora do que depois
  // de a pessoa digitar a senha nova duas vezes.
  const account = await accountForResetToken(token)
  return { token, valid: account !== null }
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const result = await completePasswordReset({
    token: String(form.get('token') ?? ''),
    password: String(form.get('password') ?? ''),
    confirmation: String(form.get('confirmation') ?? ''),
  })
  if (!result.ok) {
    return { ok: false, message: result.error }
  }
  return { ok: true, message: 'Senha alterada. Já pode entrar com a nova.' }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Hermes — Redefinir senha' }]
}

export default function RedefinirSenha({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const submitting = navigation.state !== 'idle'

  if (actionData?.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-5 text-center">
          <div className="flex justify-center">
            <Logo />
          </div>
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-deep">
            <WingMark accent className="size-6 text-white" />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight">Senha redefinida</h1>
          <p className="text-sm text-ink-soft">{actionData.message}</p>
          <Link to="/login" className="inline-block text-sm font-medium text-brand hover:underline">
            Ir para o login
          </Link>
        </div>
      </main>
    )
  }

  if (!loaderData.valid) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-5 text-center">
          <div className="flex justify-center">
            <Logo />
          </div>
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border bg-surface font-display text-xl font-bold text-ink-soft">
            !
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Link inválido ou expirado
          </h1>
          <p className="text-sm text-ink-soft">
            Links de redefinição valem por 1 hora e deixam de funcionar depois que a senha é
            trocada. Peça um novo para continuar.
          </p>
          <Link
            to="/esqueci-senha"
            className="inline-block text-sm font-medium text-brand hover:underline"
          >
            Pedir outro link
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold tracking-tight">Criar senha nova</h1>
          <p className="text-sm text-ink-soft">Escolha uma senha de ao menos 8 caracteres.</p>
        </div>

        <Form method="post" className="space-y-4">
          <input type="hidden" name="token" value={loaderData.token} />
          <TextField
            label="Nova senha"
            type="password"
            name="password"
            required
            autoComplete="new-password"
            placeholder="mínimo 8 caracteres"
          />
          <TextField
            label="Repita a nova senha"
            type="password"
            name="confirmation"
            required
            autoComplete="new-password"
            placeholder="••••••••"
          />
          {actionData?.message && <p className="text-sm text-urgent">{actionData.message}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
            {submitting ? 'Salvando…' : 'Salvar senha'}
          </Button>
        </Form>
      </div>
    </main>
  )
}
