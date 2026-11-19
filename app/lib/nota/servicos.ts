import type { ServicoFiscal } from './tipos'

// TABELA DE EXEMPLO. Não são códigos validados por contador nem por prefeitura.
// Cada clínica terá a sua tabela, confirmada pelo contador dela, antes de qualquer nota real.
export const SERVICOS_EXEMPLO: readonly ServicoFiscal[] = [
  {
    chave: 'consulta_odonto',
    descricaoNota: 'Serviço odontológico',
    codigoServicoMunicipal: '4.12',
    nomeServicoMunicipal: 'Odontologia (exemplo)',
    exemplo: true,
  },
  {
    chave: 'consulta_clinica',
    descricaoNota: 'Serviço de saúde',
    codigoServicoMunicipal: '4.01',
    nomeServicoMunicipal: 'Medicina (exemplo)',
    exemplo: true,
  },
]

export const SERVICO_PADRAO = 'consulta_odonto'

export function buscarServico(chave: string): ServicoFiscal | null {
  return SERVICOS_EXEMPLO.find((s) => s.chave === chave) ?? null
}
