// Endpoint de métricas do motor. Dois formatos, o mesmo dado:
//   /metrics                      → exposition format do Prometheus (Grafana raspa daqui)
//   /metrics?formato=texto        → relatório legível, para ler no terminal por SSH
// Filtros: ?minutos=<n> e ?tenant=<slug>.
//
// Sem `METRICS_TOKEN` no ambiente a rota responde 404 (ver metrics-auth.ts).

import { formatPrometheus, formatTextReport } from '../lib/metrics'
import { readLatencyReport } from '../lib/metrics.server'
import { authorizeMetrics, parseWindowMinutes } from '../lib/metrics-auth'
import type { Route } from './+types/metrics'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = authorizeMetrics(request, process.env.METRICS_TOKEN)
  if (!auth.ok) {
    throw new Response(auth.reason === 'nao_configurado' ? 'Not Found' : 'Unauthorized', {
      status: auth.status,
    })
  }

  const url = new URL(request.url)
  const report = await readLatencyReport({
    windowMinutes: parseWindowMinutes(url.searchParams.get('minutos')),
    tenantSlug: url.searchParams.get('tenant') ?? undefined,
  })

  const texto = url.searchParams.get('formato') === 'texto'
  return new Response(texto ? formatTextReport(report) : formatPrometheus(report), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Métrica é sempre "agora": nada de cache em proxy/navegador.
      'Cache-Control': 'no-store',
    },
  })
}
