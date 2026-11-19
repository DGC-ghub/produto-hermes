import { tratarWebhookAsaas } from './asaas-webhook'
import { formatarReais } from './mensagens'
import type { EmissorFiscal } from './tipos'

// Cliente do Asaas SANDBOX. Recusa qualquer URL que não seja de sandbox: nenhuma nota real.
// Cliente fictício (CPF de exemplo, sem pessoa real).
const CLIENTE_FICTICIO = { name: 'Paciente Demo (fictício)', cpfCnpj: '24971563792' }

export const HOST_SANDBOX_ASAAS = 'api-sandbox.asaas.com'

/** Só https e o host exato do sandbox: a chave nunca vai para outro destino. */
export function urlEhSandbox(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === HOST_SANDBOX_ASAAS
  } catch {
    return false
  }
}

export type AsaasConfig = { apiKey: string; baseUrl: string; fetchFn?: typeof fetch }

export function lerConfigAsaas(env: Record<string, string | undefined>): AsaasConfig | null {
  const apiKey = env.ASAAS_API_KEY?.trim()
  const baseUrl = env.ASAAS_BASE_URL?.trim()
  if (!apiKey || !baseUrl) {
    return null
  }
  return { apiKey, baseUrl }
}

export function criarEmissorAsaas(config: AsaasConfig): EmissorFiscal {
  const base = config.baseUrl.replace(/\/+$/, '')
  if (!urlEhSandbox(base)) {
    throw new Error('ASAAS_BASE_URL deve ser o sandbox. A demo não emite nota real.')
  }
  const doFetch = config.fetchFn ?? fetch

  async function chamar(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown) {
    const resp = await doFetch(`${base}${caminho}`, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        access_token: config.apiKey,
        'User-Agent': 'dgc-hermes-demo',
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    })
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>
    if (!resp.ok) {
      // Não repete o corpo inteiro (pode ter dado do cliente); só o status e o caminho.
      throw new Error(`Asaas respondeu ${resp.status} em ${metodo} ${caminho}`)
    }
    return json
  }

  return {
    async criarCobrancaPix(input) {
      const cliente = await chamar('POST', '/customers', CLIENTE_FICTICIO)
      const venc = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
      const pagamento = await chamar('POST', '/payments', {
        customer: cliente.id,
        billingType: 'PIX',
        value: input.valorCentavos / 100,
        dueDate: venc,
        description: `${input.descricao} (teste) ${formatarReais(input.valorCentavos)}`,
        externalReference: input.referencia,
      })
      const id = String(pagamento.id)
      const qr = await chamar('GET', `/payments/${id}/pixQrCode`)
      return { id, pixCopiaECola: String(qr.payload ?? '') }
    },
    async emitirNota(input) {
      const nota = await chamar('POST', '/invoices', {
        payment: input.cobrancaId,
        serviceDescription: input.servico.descricaoNota,
        observations: 'Nota de HOMOLOGAÇÃO (demonstração).',
        externalReference: input.referencia,
        value: input.valorCentavos / 100,
        deductions: 0,
        effectiveDate: new Date().toISOString().slice(0, 10),
        municipalServiceCode: input.servico.codigoServicoMunicipal,
        municipalServiceName: input.servico.nomeServicoMunicipal,
        taxes: { retainIss: false, iss: 0, cofins: 0, csll: 0, inss: 0, ir: 0, pis: 0 },
      })
      return { notaId: String(nota.id) }
    },
    tratarWebhook: tratarWebhookAsaas,
  }
}
