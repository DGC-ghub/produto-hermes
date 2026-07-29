import { Form, Link, useActionData, useNavigation } from 'react-router'
import { Logo } from '../components/brand/BrandMark'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'
import { startPasswordReset } from '../lib/password-reset.server'
import {
  checkRate,
  isLockedOut,
  type RateState,
  rateConfig,
  recordFailure,
} from '../lib/rate-limit'
import type { Route } from './+types/esqueci-senha'

// Pedido de redefinição de senha. Rota PÚBLICA de propósito: quem esqueceu a senha não está
// logado. Duas travas, como no /login e no /signup:
//  1. Teto POR E-MAIL — sem ele o formulário vira máquina de bombardear a caixa de alguém.
//  2. Teto GLOBAL por janela — rede anti-flood do processo (atrás da ponte do Tailscale não há
//     IP confiável pra limitar por origem).
const REQUESTS_PER_EMAIL = 3
const EMAIL_WINDOW_MS = 15 * 60_000
const GLOBAL_MAX_PER_WINDOW = 20
const MAX_TRACKED_EMAILS = 1000

const requestsByEmail = new Map<string, RateState>()
let resetRateState: RateState = { windowStart: 0, count: 0 }

// A MESMA resposta para e-mail que existe e e-mail que não existe: senão o formulário é um
// oráculo de "quem é cliente do Hermes" (enumeração de contas).
const SENT_MESSAGE =
  'Se existir uma conta com esse e-mail, enviamos o link para redefinir a senha. Confira também a caixa de spam.'

export async function action({ request }: Route.ActionArgs) {
  const now = Date.now()
  const rate = checkRate(now, resetRateState, GLOBAL_MAX_PER_WINDOW, rateConfig().windowMs)
  resetRateState = rate.state
  if (!rate.allowed) {
    return { ok: false, message: `Muitos pedidos agora. Tente de novo em ${rate.retryAfterSec}s.` }
  }

  const form = await request.formData()
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase()
  const baseUrl = new URL(request.url).origin

  // Estourou o teto do e-mail: não envia, mas responde EXATAMENTE o mesmo — nem o limite pode
  // virar sinal de que a conta existe.
  if (!isLockedOut(now, requestsByEmail.get(email), REQUESTS_PER_EMAIL, EMAIL_WINDOW_MS)) {
    // Teto de memória: e-mails aleatórios de scanner não crescem o Map pra sempre.
    if (requestsByEmail.size >= MAX_TRACKED_EMAILS) {
      requestsByEmail.clear()
    }
    requestsByEmail.set(email, recordFailure(now, requestsByEmail.get(email), EMAIL_WINDOW_MS))
    // Retorno ignorado de propósito: saber se enviou não pode influenciar a resposta.
    await startPasswordReset(email, baseUrl)
  }
  return { ok: true, message: SENT_MESSAGE }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Hermes — Esqueci minha senha' }]
}

export default function EsqueciSenha() {
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const submitting = navigation.state !== 'idle'

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Logo />
        </div>

        {actionData?.ok ? (
          <div className="space-y-3 text-center">
            <h1 className="font-display text-2xl font-bold tracking-tight">Link a caminho</h1>
            <p className="text-sm text-ink-soft">{actionData.message}</p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="font-display text-2xl font-bold tracking-tight">
                Esqueci minha senha
              </h1>
              <p className="text-sm text-ink-soft">
                Informe o e-mail da conta. Enviamos um link para você criar uma senha nova.
              </p>
            </div>

            <Form method="post" className="space-y-4">
              <TextField
                label="E-mail"
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="voce@empresa.com"
              />
              {actionData?.message && <p className="text-sm text-urgent">{actionData.message}</p>}
              <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
                {submitting ? 'Enviando…' : 'Enviar link'}
              </Button>
            </Form>
          </>
        )}

        <p className="text-center text-sm text-ink-soft">
          Lembrou a senha?{' '}
          <Link to="/login" className="text-brand underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  )
}
