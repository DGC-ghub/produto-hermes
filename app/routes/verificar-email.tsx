import { Link } from 'react-router'
import { Logo, WingMark } from '../components/brand/BrandMark'
import { confirmEmailVerification } from '../lib/email-verification.server'
import type { Route } from './+types/verificar-email'

export async function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  const accountId = await confirmEmailVerification(token)
  return { ok: accountId !== null }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Hermes — Confirmação de e-mail' }]
}

export default function VerificarEmail({ loaderData }: Route.ComponentProps) {
  const { ok } = loaderData

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        {ok ? (
          <div className="space-y-3">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-deep">
              <WingMark accent className="size-6 text-white" />
            </span>
            <h1 className="font-display text-2xl font-bold tracking-tight">E-mail confirmado</h1>
            <p className="text-sm text-ink-soft">
              Sua conta está ativa. Já pode entrar e configurar o atendimento.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border bg-surface font-display text-xl font-bold text-ink-soft">
              !
            </span>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              Link inválido ou expirado
            </h1>
            <p className="text-sm text-ink-soft">
              O link de confirmação não vale mais. Entre e reenvie a confirmação.
            </p>
          </div>
        )}
        <Link to="/login" className="inline-block text-sm font-medium text-brand hover:underline">
          Ir para o login
        </Link>
      </div>
    </main>
  )
}
