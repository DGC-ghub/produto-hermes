import { Form, redirect, useActionData } from 'react-router'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { requireOwner } from '../lib/auth.server'
import { startSubscription } from '../lib/billing.server'
import { PLANS, type PlanId } from '../lib/subscription.server'
import type { Route } from './+types/assinar'

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOwner(request)
  return {
    operator: { username: operator.username, tenantSlug: operator.tenantSlug },
    plans: Object.values(PLANS),
  }
}

export async function action({ request }: Route.ActionArgs) {
  const operator = await requireOwner(request)
  const form = await request.formData()
  const planId = String(form.get('planId') ?? '') as PlanId
  if (!(planId in PLANS)) {
    return { error: 'Plano inválido.' }
  }
  const backUrl = `${new URL(request.url).origin}/dashboard`
  const checkout = await startSubscription({
    tenantId: operator.tenantId,
    planId,
    payerEmail: operator.username, // o username da sessão é o e-mail da conta
    backUrl,
  })
  if (!checkout) {
    return {
      error: 'Pagamento indisponível agora (Mercado Pago não configurado). Tente mais tarde.',
    }
  }
  return redirect(checkout)
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Hermes — Assinar' }]
}

export default function Assinar({ loaderData }: Route.ComponentProps) {
  const { operator, plans } = loaderData
  const actionData = useActionData<typeof action>()

  return (
    <AppShell operator={operator}>
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
          Escolha seu plano
        </h1>
        <p className="mt-1 text-sm text-ink-soft">Assinatura mensal, cancele quando quiser.</p>

        {actionData?.error && <p className="mt-4 text-sm text-urgent">{actionData.error}</p>}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <Card key={plan.id} className="p-5">
              <h2 className="font-display text-lg font-bold text-ink">{plan.nome}</h2>
              <p className="mt-1 text-2xl font-bold text-ink">
                R$ {(plan.precoCentavos / 100).toFixed(0)}
                <span className="text-sm font-normal text-ink-soft">/mês</span>
              </p>
              <Form method="post" className="mt-4">
                <input type="hidden" name="planId" value={plan.id} />
                <Button type="submit" variant="primary" className="w-full">
                  Assinar
                </Button>
              </Form>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
