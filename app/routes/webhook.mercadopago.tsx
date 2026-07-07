import { syncSubscriptionFromMp } from '../lib/billing.server'
import type { Route } from './+types/webhook.mercadopago'

// Webhook do Mercado Pago (marco M3): o MP notifica (query ?data.id= ou body JSON) quando uma
// assinatura muda de estado. Extraímos o id, buscamos a fonte da verdade no MP e sincronizamos —
// o sync é seguro (só afeta um preapproval que já conhecemos). Respondemos 200 sempre, senão o
// MP fica re-tentando.
async function handleNotification(request: Request): Promise<Response> {
  const url = new URL(request.url)
  let id = url.searchParams.get('data.id') ?? url.searchParams.get('id')
  if (!id && request.method === 'POST') {
    try {
      const body = (await request.json()) as { data?: { id?: string | number } }
      id = body.data?.id != null ? String(body.data.id) : null
    } catch {
      // body não-JSON: ignora
    }
  }
  if (id) {
    await syncSubscriptionFromMp(id)
  }
  return new Response('ok', { status: 200 })
}

export async function action({ request }: Route.ActionArgs) {
  return handleNotification(request)
}

export async function loader({ request }: Route.LoaderArgs) {
  return handleNotification(request)
}
