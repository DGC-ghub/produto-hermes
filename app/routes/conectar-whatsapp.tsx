import { Form, redirect, useActionData, useNavigation } from 'react-router'
import { WingMark } from '../components/brand/BrandMark'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { TextField } from '../components/ui/TextField'
import { requireOwner } from '../lib/auth.server'
import {
  getWhatsappNumberOwnerSlug,
  listTenantWhatsappNumbers,
  registerWhatsappNumber,
} from '../lib/whatsapp.server'
import { setWhatsappCredential } from '../lib/whatsapp-credential.server'
import type { Route } from './+types/conectar-whatsapp'

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand'

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOwner(request)
  const numbers = await listTenantWhatsappNumbers(operator.tenantSlug)
  return {
    numbers,
    operator: { username: operator.username, tenantSlug: operator.tenantSlug },
  }
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Hermes — Conectar WhatsApp' },
    { name: 'description', content: 'Ligue o número de WhatsApp da sua empresa ao atendente.' },
  ]
}

export async function action({ request }: Route.ActionArgs) {
  const operator = await requireOwner(request)
  const form = await request.formData()
  const phoneNumberId = String(form.get('phoneNumberId') ?? '').trim()
  const label = String(form.get('label') ?? '').trim() || undefined
  const accessToken = String(form.get('accessToken') ?? '').trim()

  if (!phoneNumberId) {
    return { error: 'Informe o ID do número (phone_number_id) que aparece no painel da Meta.' }
  }
  // Anti-sequestro: não deixa reatribuir um número que já é de outra empresa.
  const owner = await getWhatsappNumberOwnerSlug(phoneNumberId)
  if (owner && owner !== operator.tenantSlug) {
    return { error: 'Esse número já está conectado a outra conta. Se for seu, fale com o suporte.' }
  }
  try {
    await registerWhatsappNumber(phoneNumberId, operator.tenantSlug, label)
    // Só grava o token se foi informado — deixar em branco mantém o atual (não apaga).
    if (accessToken) {
      await setWhatsappCredential(phoneNumberId, { accessToken })
    }
    return redirect('/conectar-whatsapp')
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Não consegui conectar. Confira os dados.',
    }
  }
}

export default function ConectarWhatsapp({ loaderData }: Route.ComponentProps) {
  const { numbers, operator } = loaderData
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const saving = navigation.state !== 'idle'
  const connected = numbers.length > 0

  return (
    <AppShell operator={operator}>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-5">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            Conectar WhatsApp
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Ligue o número de WhatsApp da sua empresa para o Hermes atender por lá.
          </p>
        </header>

        {connected && (
          <Card className="mb-4 flex items-start gap-3 border-brand/30 bg-brand/5 p-4">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-deep">
              <WingMark accent className="size-4 text-white" />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-ink">
                {numbers.length === 1 ? 'Número conectado' : `${numbers.length} números conectados`}
              </p>
              <ul className="mt-1 space-y-0.5 text-sm text-ink-soft">
                {numbers.map((n) => (
                  <li key={n.phoneNumberId}>
                    {n.label ? `${n.label} · ` : ''}
                    <span className="font-mono text-xs">{n.phoneNumberId}</span>
                    {' — '}
                    {n.hasOwnToken ? 'token próprio ✓' : 'sem token próprio (configure abaixo)'}
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}

        <Card className="mb-4 p-5">
          <h2 className="font-display text-base font-bold text-ink">Onde achar esses dados</h2>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-ink-soft">
            <li>
              Entre no <span className="font-medium text-ink">Meta for Developers</span> → seu app →{' '}
              <span className="font-medium text-ink">WhatsApp → API Setup</span>.
            </li>
            <li>
              Copie o <span className="font-medium text-ink">Phone number ID</span> (o ID do número,
              não o telefone) e cole no campo abaixo.
            </li>
            <li>
              Gere um <span className="font-medium text-ink">Access Token</span> permanente do
              número e cole no campo de token.
            </li>
          </ol>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-base font-bold text-ink">
            {connected ? 'Atualizar conexão' : 'Conectar um número'}
          </h2>
          <Form method="post" className="mt-3 space-y-3">
            <TextField
              label="Apelido (opcional)"
              name="label"
              placeholder="Ex.: Atendimento principal"
            />
            <TextField
              label="Phone number ID"
              name="phoneNumberId"
              required
              placeholder="Ex.: 123456789012345"
            />
            <label className="block">
              <span className="mb-1.5 block text-xs text-ink-soft">
                Access Token {connected && '(deixe em branco para manter o atual)'}
              </span>
              <input
                type="password"
                name="accessToken"
                autoComplete="off"
                placeholder="Cole o token da Cloud API"
                className={inputClass}
              />
            </label>
            {actionData?.error && <p className="text-sm text-urgent">{actionData.error}</p>}
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Conectando…' : connected ? 'Salvar' : 'Conectar WhatsApp'}
            </Button>
          </Form>
        </Card>
      </div>
    </AppShell>
  )
}
