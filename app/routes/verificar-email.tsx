import { Form, Link, useActionData, useNavigation } from 'react-router'
import { Logo, WingMark } from '../components/brand/BrandMark'
import { Button } from '../components/ui/Button'
import { getOperator } from '../lib/auth.server'
import { confirmEmailVerification } from '../lib/email-verification.server'
import { resendVerification } from '../lib/signup.server'
import type { Route } from './+types/verificar-email'

// Esta tela tem dois papéis: confirmar o token que chegou por e-mail e, quando não há token,
// mostrar o ESTADO da confirmação — inclusive o caso em que o e-mail não conseguiu sair
// (`?envio=falhou`, vindo do cadastro). Nos dois casos há um caminho real de reenvio.

type Status = 'confirmado' | 'invalido' | 'nao-enviado' | 'pendente'

const COPY: Record<Status, { title: string; text: string }> = {
  confirmado: {
    title: 'E-mail confirmado',
    text: 'Sua conta está ativa. Já pode entrar e configurar o atendimento.',
  },
  invalido: {
    title: 'Link inválido ou expirado',
    text: 'O link de confirmação não vale mais — peça um novo abaixo.',
  },
  'nao-enviado': {
    title: 'Conta criada',
    text: 'Sua conta está ativa, mas não conseguimos enviar o e-mail de confirmação agora. Você pode reenviar.',
  },
  pendente: {
    title: 'Confirme seu e-mail',
    text: 'Abra o link que enviamos para ativar tudo. Não chegou? Reenvie abaixo.',
  },
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? ''
  // Só quem está logado reenvia: o destino sai da sessão, nunca de um campo do formulário —
  // senão a tela vira um disparador de e-mail para qualquer endereço que alguém digitar.
  const canResend = (await getOperator(request)) !== null

  if (!token) {
    const status: Status = url.searchParams.get('envio') === 'falhou' ? 'nao-enviado' : 'pendente'
    return { status, canResend }
  }
  const accountId = await confirmEmailVerification(token)
  const status: Status = accountId !== null ? 'confirmado' : 'invalido'
  return { status, canResend }
}

export async function action({ request }: Route.ActionArgs) {
  const operator = await getOperator(request)
  if (!operator) {
    return { ok: false as const, error: 'Entre na sua conta para reenviar a confirmação.' }
  }

  const result = await resendVerification(
    { id: operator.accountId, email: operator.username },
    new URL(request.url).origin,
  )
  if (!result.ok) {
    return {
      ok: false as const,
      error: `Já reenviamos há pouco. Tente de novo em ${result.retryAfterSec}s.`,
    }
  }
  if (!result.sent) {
    // Mesma honestidade do cadastro: se o provedor recusou, não dá para dizer "enviado".
    return {
      ok: false as const,
      error: 'Não conseguimos enviar agora. Tente daqui a pouco ou chame o suporte.',
    }
  }
  return { ok: true as const, message: `Novo link enviado para ${operator.username}.` }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Hermes — Confirmação de e-mail' }]
}

export default function VerificarEmail({ loaderData }: Route.ComponentProps) {
  const { status, canResend } = loaderData
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const sending = navigation.state !== 'idle'
  const copy = COPY[status]
  const loginFirst = status === 'confirmado' || !canResend
  const loginLink =
    status === 'confirmado'
      ? '/login'
      : `/login?redirectTo=${encodeURIComponent('/verificar-email')}`

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>

        <div className="space-y-3">
          {status === 'confirmado' ? (
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-deep">
              <WingMark accent className="size-6 text-white" />
            </span>
          ) : (
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border bg-surface font-display text-xl font-bold text-ink-soft">
              !
            </span>
          )}
          <h1 className="font-display text-2xl font-bold tracking-tight">{copy.title}</h1>
          <p className="text-sm text-ink-soft">{copy.text}</p>
        </div>

        {status !== 'confirmado' &&
          (canResend ? (
            <Form method="post" className="space-y-3">
              <Button type="submit" variant="secondary" className="w-full" disabled={sending}>
                {sending ? 'Reenviando…' : 'Reenviar confirmação'}
              </Button>
              {actionData?.ok && (
                <p className="inline-flex items-center gap-1.5 text-sm text-brand">
                  <span className="size-1.5 rounded-full bg-brand" />
                  {actionData.message}
                </p>
              )}
              {actionData?.ok === false && (
                <p className="text-sm text-urgent">{actionData.error}</p>
              )}
            </Form>
          ) : (
            <p className="text-sm text-ink-soft">Entre na sua conta para reenviar a confirmação.</p>
          ))}

        {/* Quem não está logado precisa entrar ANTES de reenviar — por isso o login volta pra cá. */}
        <Link
          to={loginFirst ? loginLink : '/atendente'}
          className="inline-block text-sm font-medium text-brand hover:underline"
        >
          {loginFirst ? 'Ir para o login' : 'Ir para o painel'}
        </Link>
      </div>
    </main>
  )
}
