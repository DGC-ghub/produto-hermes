import { tratarWebhookAsaas } from './asaas-webhook'
import type { EmissorFiscal } from './tipos'

/**
 * Emissor falso: roda a demo sem chave e sem rede. Payloads no formato do webhook do Asaas.
 */
export function criarEmissorFalso(): EmissorFiscal {
  let seq = 0
  return {
    async criarCobrancaPix(input) {
      seq += 1
      const id = `pay_fake_${Date.now().toString(36)}_${seq}`
      return { id, pixCopiaECola: `00020126FAKE-PIX-DE-TESTE-${input.valorCentavos}-${id}` }
    },
    async emitirNota(input) {
      seq += 1
      return { notaId: `inv_fake_${input.cobrancaId.replace('pay_fake_', '')}_${seq}` }
    },
    tratarWebhook: tratarWebhookAsaas,
  }
}

export function pdfUrlFalso(notaId: string, base = ''): string {
  return `${base}/demo/nota-exemplo?tipo=pdf&id=${encodeURIComponent(notaId)}`
}

export function xmlUrlFalso(notaId: string, base = ''): string {
  return `${base}/demo/nota-exemplo?tipo=xml&id=${encodeURIComponent(notaId)}`
}
