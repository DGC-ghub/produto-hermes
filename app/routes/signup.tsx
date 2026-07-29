import { Form, Link, redirect, useActionData, useNavigation } from 'react-router'
import { Logo, WingMark } from '../components/brand/BrandMark'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'
import { appUrlFor } from '../lib/app-url.server'
import { createOperatorSession, getOperator } from '../lib/auth.server'
import { checkRate, type RateState, rateConfig } from '../lib/rate-limit'
import { postSignupPath, registerOwner } from '../lib/signup.server'
import type { Route } from './+types/signup'

// Teto global anti-spam de cadastro: cada conta nova provisiona um tenant + dispara um
// e-mail (Resend), então limitamos o volume por janela. Sem IP confiável atrás da ponte
// do Tailscale, o teto é por processo — zera a cada reinício. Barra flood em massa.
const SIGNUP_MAX_PER_WINDOW = 10
let signupRateState: RateState = { windowStart: 0, count: 0 }

export async function loader({ request }: Route.LoaderArgs) {
  if (await getOperator(request)) {
    throw redirect('/atendente')
  }
  return null
}

export async function action({ request }: Route.ActionArgs) {
  // Anti-spam: rejeita o excesso ANTES de provisionar tenant / disparar e-mail.
  const rate = checkRate(Date.now(), signupRateState, SIGNUP_MAX_PER_WINDOW, rateConfig().windowMs)
  signupRateState = rate.state
  if (!rate.allowed) {
    return {
      error: `Muitas tentativas de cadastro agora. Tente de novo em ${rate.retryAfterSec}s.`,
    }
  }

  const form = await request.formData()
  const companyName = String(form.get('companyName') ?? '')
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  const baseUrl = appUrlFor(request)

  const result = await registerOwner({ companyName, email, password, baseUrl })
  if (!result.ok) {
    return { error: result.error }
  }
  // Loga o dono já — o e-mail entra não-verificado (confirmação a caminho).
  // O destino depende de o e-mail ter saído mesmo: se o provedor recusou, a conta está criada
  // e funcionando, mas mandar direto pro painel faria a pessoa esperar um e-mail que nunca vem.
  return createOperatorSession(
    {
      accountId: result.accountId,
      email: result.email,
      role: 'owner',
      tenantId: result.tenantId,
      tenantSlug: result.slug,
    },
    postSignupPath(result),
  )
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Hermes — Criar conta' }]
}

export default function Signup() {
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const submitting = navigation.state !== 'idle'

  return (
    <main className="flex min-h-screen">
      <aside className="hidden w-1/2 flex-col justify-between bg-brand-deep p-10 text-white md:flex">
        <div className="flex items-center gap-2">
          <WingMark accent className="size-7 text-white" />
          <span className="font-display text-xl font-bold tracking-tight">Hermes</span>
        </div>
        <div>
          <p className="font-display text-3xl font-bold leading-tight">
            Seu atendente de WhatsApp, no ar em minutos.
          </p>
          <p className="mt-3 text-sm text-white/70">
            Cadastre a empresa, plugue o número e comece a responder.
          </p>
        </div>
        <p className="text-xs text-white/40">Sem cartão para começar.</p>
      </aside>

      <div className="flex w-full items-center justify-center p-6 md:w-1/2">
        <div className="w-full max-w-sm space-y-6">
          <div className="md:hidden">
            <Logo />
          </div>
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-bold tracking-tight">Criar conta</h1>
            <p className="text-sm text-ink-soft">Comece o atendimento da sua empresa.</p>
          </div>

          <Form method="post" className="space-y-4">
            <TextField
              label="Nome da empresa"
              name="companyName"
              required
              placeholder="Minha Empresa Ltda"
            />
            <TextField
              label="E-mail"
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="voce@empresa.com"
            />
            <TextField
              label="Senha"
              type="password"
              name="password"
              required
              autoComplete="new-password"
              placeholder="mínimo 8 caracteres"
            />
            {actionData?.error && <p className="text-sm text-urgent">{actionData.error}</p>}
            <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
              {submitting ? 'Criando conta…' : 'Criar conta'}
            </Button>
            <p className="text-center text-sm text-ink-soft">
              Já tem conta?{' '}
              <Link to="/login" className="text-brand underline">
                Entrar
              </Link>
            </p>
          </Form>
        </div>
      </div>
    </main>
  )
}
