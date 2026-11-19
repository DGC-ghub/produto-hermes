import { processarEvento } from '../lib/nota/fluxo'
import { criarDeps, tokenWebhookValido } from '../lib/nota/nota.server'
import type { Route } from './+types/api.asaas.webhook'

// Webhook do Asaas (sandbox). Sem token válido, recusa. Resposta 200 mesmo para evento ignorado,
// para o Asaas não pausar a fila de webhooks.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return new Response('Método não permitido', { status: 405 })
  }
  if (!tokenWebhookValido(request.headers.get('asaas-access-token'))) {
    return new Response('Não autorizado', { status: 401 })
  }
  const payload = await request.json().catch(() => null)
  const deps = criarDeps()
  const evento = deps.emissor.tratarWebhook(payload)
  if (evento) {
    await processarEvento(evento, deps)
  }
  return new Response('ok', { status: 200 })
}
