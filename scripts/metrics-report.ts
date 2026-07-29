/**
 * Relatório de latência do motor no terminal — a régua para responder
 * "onde foram os 20 segundos?" direto no Pi, sem subir Grafana.
 *
 *   npm run metrics                        # última hora, todos os tenants
 *   npm run metrics -- --minutos 1440      # último dia
 *   npm run metrics -- --tenant csmed      # só um cliente
 *   npm run metrics -- --prometheus        # saída crua no formato do Prometheus
 */

import { formatPrometheus, formatTextReport } from '../app/lib/metrics'
import { readLatencyReport } from '../app/lib/metrics.server'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const minutos = Number(arg('minutos') ?? 60)
  const report = await readLatencyReport({
    windowMinutes: Number.isFinite(minutos) && minutos > 0 ? minutos : 60,
    tenantSlug: arg('tenant'),
  })

  if (process.argv.includes('--prometheus')) {
    console.log(formatPrometheus(report))
    return
  }

  console.log(formatTextReport(report))
  if (report.total.count > 0) {
    console.log('')
    console.log(
      `Desfechos: ${Object.entries(report.outcomes)
        .map(([nome, qtd]) => `${nome}=${qtd}`)
        .join(' · ')}`,
    )
    console.log(
      `Providers: ${Object.entries(report.providers)
        .map(([nome, qtd]) => `${nome}=${qtd}`)
        .join(' · ')}`,
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
