const PADRAO_REJEICAO =
  'A prefeitura recusou a nota; confira os dados com o contador. (O emissor não informou o motivo.)'

const LIMITE = 300

/** Motivo da rejeição em português simples para a recepção. Nunca devolve texto vazio. */
export function motivoRejeicaoParaRecepcao(motivoBruto: string | null | undefined): string {
  const texto = (motivoBruto ?? '').replace(/\s+/g, ' ').trim()
  if (texto.length === 0) {
    return PADRAO_REJEICAO
  }
  const cortado = texto.length > LIMITE ? `${texto.slice(0, LIMITE)}…` : texto
  return `A prefeitura recusou a nota: ${cortado}. Confira os dados com o contador.`
}

export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function mensagemPix(valorCentavos: number, pixCopiaECola: string): string {
  return [
    `Atendimento concluído. Valor: ${formatarReais(valorCentavos)}.`,
    'Pague pelo Pix (cobrança de TESTE):',
    pixCopiaECola,
  ].join('\n')
}

export function mensagemNotaPaciente(pdfUrl: string, xmlUrl: string): string {
  return [
    'Pagamento confirmado. Segue sua nota fiscal (HOMOLOGAÇÃO, sem valor fiscal):',
    `PDF: ${pdfUrl}`,
    `XML: ${xmlUrl}`,
  ].join('\n')
}
