import { Logo } from '../components/brand/BrandMark'
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
          <>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              E-mail confirmado! ✅
            </h1>
            <p className="text-sm text-ink-soft">
              Sua conta está ativa. Já pode entrar e configurar o atendimento.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              Link inválido ou expirado
            </h1>
            <p className="text-sm text-ink-soft">
              O link de confirmação não vale mais. Entre e reenvie a confirmação.
            </p>
          </>
        )}
        <a href="/login" className="inline-block text-sm text-brand underline">
          Ir para o login
        </a>
      </div>
    </main>
  )
}
