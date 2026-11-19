import type { EventoFiscal } from './tipos'

type Obj = Record<string, unknown>

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === 'object' ? (v as Obj) : null
}

function texto(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/**
 * Traduz o webhook do Asaas (PAYMENT_RECEIVED, INVOICE_AUTHORIZED, INVOICE_ERROR).
 * Função pura. Retorna null para eventos que o fluxo não usa ou payload malformado.
 * Formato conforme a doc pública do Asaas; conferir com o sandbox quando a chave chegar.
 */
export function tratarWebhookAsaas(payload: unknown): EventoFiscal | null {
  const raiz = obj(payload)
  const evento = texto(raiz?.event)
  if (!raiz || !evento) {
    return null
  }

  if (evento === 'PAYMENT_RECEIVED') {
    const id = texto(obj(raiz.payment)?.id)
    return id ? { tipo: 'pagamento_recebido', cobrancaId: id } : null
  }

  const invoice = obj(raiz.invoice)
  const notaId = texto(invoice?.id)
  if (!invoice || !notaId) {
    return null
  }

  if (evento === 'INVOICE_AUTHORIZED') {
    const pdfUrl = texto(invoice.pdfUrl)
    const xmlUrl = texto(invoice.xmlUrl)
    if (!pdfUrl || !xmlUrl) {
      return null
    }
    return { tipo: 'nota_autorizada', notaId, pdfUrl, xmlUrl }
  }

  if (evento === 'INVOICE_ERROR') {
    return {
      tipo: 'nota_rejeitada',
      notaId,
      motivoBruto: texto(invoice.statusDescription),
      payloadBruto: payload,
    }
  }

  return null
}
