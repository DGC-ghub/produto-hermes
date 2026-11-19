// Tipos e interface do módulo M7 (nota automática). Só ambiente de teste/homologação.

export type ServicoFiscal = {
  chave: string
  // Descrição genérica no item da nota (LGPD: nunca o procedimento do paciente).
  descricaoNota: string
  // Códigos fiscais de EXEMPLO. O contador do cliente confirma antes de qualquer nota real.
  codigoServicoMunicipal: string
  nomeServicoMunicipal: string
  exemplo: true
}

export type CobrancaPix = {
  id: string
  pixCopiaECola: string
}

export type EventoFiscal =
  | { tipo: 'pagamento_recebido'; cobrancaId: string }
  | { tipo: 'nota_autorizada'; notaId: string; pdfUrl: string; xmlUrl: string }
  | { tipo: 'nota_rejeitada'; notaId: string; motivoBruto: string | null; payloadBruto: unknown }

export type CriarCobrancaInput = {
  referencia: string
  valorCentavos: number
  descricao: string
}

export type EmitirNotaInput = {
  cobrancaId: string
  referencia: string
  valorCentavos: number
  servico: ServicoFiscal
}

// Interface pequena: a demo só conhece isto. Trocar de emissor = trocar a implementação.
export interface EmissorFiscal {
  criarCobrancaPix(input: CriarCobrancaInput): Promise<CobrancaPix>
  emitirNota(input: EmitirNotaInput): Promise<{ notaId: string }>
  // Função pura: traduz o payload do webhook; null = evento que não nos interessa.
  tratarWebhook(payload: unknown): EventoFiscal | null
}
