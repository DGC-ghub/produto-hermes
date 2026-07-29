import { Form, redirect, useActionData } from 'react-router'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { appUrlFor } from '../lib/app-url.server'
import { requireOwner } from '../lib/auth.server'
import { startSubscription } from '../lib/billing.server'
import { getSubscriptionStatus, PLANS, type PlanId } from '../lib/subscription.server'
import { cx } from '../lib/ui'
import type { Route } from './+types/assinar'

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOwner(request)
  const subscription = await getSubscriptionStatus(operator.tenantId)
  return {
    operator: { username: operator.username, tenantSlug: operator.tenantSlug },
    plans: Object.values(PLANS),
    subscription,
  }
}

export async function action({ request }: Route.ActionArgs) {
  const operator = await requireOwner(request)
  const form = await request.formData()
  const planId = String(form.get('planId') ?? '') as PlanId
  if (!(planId in PLANS)) {
    return { error: 'Plano inválido.' }
  }
  const backUrl = `${appUrlFor(request)}/dashboard`
  const checkout = await startSubscription({
    tenantId: operator.tenantId,
    planId,
    payerEmail: operator.username, // o username da sessão é o e-mail da conta
    backUrl,
  })
  if (!checkout) {
    // Distingue "sem gateway" de "gateway recusou": senão a tela mente "não configurado"
    // quando o token existe mas o MP barrou a cobrança. O motivo real fica no log do servidor.
    const configured = Boolean(process.env.MP_ACCESS_TOKEN)
    return {
      error: configured
        ? 'Não foi possível iniciar o pagamento agora. Tente novamente em instantes.'
        : 'Pagamento indisponível (gateway não configurado). Tente mais tarde.',
    }
  }
  return redirect(checkout)
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Hermes — Assinar' }]
}

const STATUS_META: Record<string, { label: string; dot: string }> = {
  trialing: { label: 'Teste grátis', dot: 'bg-brand' },
  active: { label: 'Assinatura ativa', dot: 'bg-brand' },
  past_due: { label: 'Pagamento pendente', dot: 'bg-waiting' },
  canceled: { label: 'Assinatura cancelada', dot: 'bg-urgent' },
}

export default function Assinar({ loaderData }: Route.ComponentProps) {
  const { operator, plans, subscription } = loaderData
  const actionData = useActionData<typeof action>()
  const statusMeta = STATUS_META[subscription.status]

  return (
    <AppShell operator={operator}>
      <div className="mx-auto max-w-2xl px-6 py-8">
        <header>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Assinatura</h1>
          <p className="mt-1 text-sm text-ink-soft">Assinatura mensal, cancele quando quiser.</p>
        </header>

        {subscription.status !== 'none' && statusMeta && (
          <Card className="mt-5 flex flex-wrap items-center justify-between gap-3 p-4">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <span className={cx('size-2 rounded-full', statusMeta.dot)} />
              {statusMeta.label}
              {subscription.planName && ` · plano ${subscription.planName}`}
            </span>
            {subscription.daysLeft != null && (
              <span className="text-sm text-ink-soft">
                {subscription.active
                  ? `${subscription.daysLeft} ${subscription.daysLeft === 1 ? 'dia restante' : 'dias restantes'}`
                  : 'período expirado'}
              </span>
            )}
          </Card>
        )}

        {actionData?.error && <p className="mt-4 text-sm text-urgent">{actionData.error}</p>}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <Card
              key={plan.id}
              className={cx('relative flex flex-col p-5', plan.destaque && 'ring-2 ring-brand')}
            >
              {plan.destaque && (
                <span className="absolute -top-2.5 left-5 rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-white">
                  Recomendado
                </span>
              )}
              <h2 className="font-display text-lg font-bold text-ink">{plan.nome}</h2>
              <p className="mt-1 text-2xl font-bold text-ink">
                R$ {(plan.precoCentavos / 100).toFixed(0)}
                <span className="text-sm font-normal text-ink-soft">/mês</span>
              </p>
              <ul className="mt-3 flex-1 space-y-1.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-ink-soft">
                    <span className="mt-0.5 font-bold text-brand">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              <Form method="post" className="mt-4">
                <input type="hidden" name="planId" value={plan.id} />
                <Button
                  type="submit"
                  variant={plan.destaque ? 'primary' : 'secondary'}
                  className="w-full"
                >
                  {subscription.planId === plan.id ? 'Renovar' : 'Assinar'}
                </Button>
              </Form>
            </Card>
          ))}
        </div>

        <p className="mt-5 text-center text-xs text-ink-soft">
          Sem fidelidade · Cancele quando quiser · Pagamento seguro pelo Mercado Pago
        </p>
      </div>
    </AppShell>
  )
}
