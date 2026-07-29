// Identificação do fornecedor e datas dos documentos legais (Termos de Uso e
// Política de Privacidade). PURO, sem banco: as duas páginas são públicas e
// renderizam no navegador.
//
// ⚠️ ESTE É O ÚNICO LUGAR PARA PREENCHER. A empresa ainda não está constituída,
// então cada campo abaixo começa como um marcador `[PREENCHER: ...]`, que as duas
// páginas destacam em amarelo para ninguém publicar sem ver. Quando sair o CNPJ,
// troque AQUI: os dois documentos passam a mostrar o dado certo sozinhos.

/** Prefixo dos campos ainda não preenchidos. Marcador é destacado na tela. */
const PLACEHOLDER_PREFIX = '[PREENCHER'

/**
 * Quem é o fornecedor do Hermes — exigido pelo Código de Defesa do Consumidor
 * (identificação clara) e pela LGPD (contato do controlador e do encarregado).
 */
export const LEGAL_ENTITY = {
  /** Razão social da empresa; enquanto não houver CNPJ, o nome civil do titular. */
  nome: '[PREENCHER: razão social ou nome completo]',
  /** CNPJ da empresa; enquanto não houver, o CPF do titular. */
  documento: '[PREENCHER: CNPJ ou CPF]',
  /** Endereço completo, com cidade e UF. */
  endereco: '[PREENCHER: endereço completo, cidade e UF]',
  /** Canal oficial de atendimento — suporte, cancelamento e avisos. */
  email: '[PREENCHER: e-mail de contato]',
  /** Encarregado de dados (DPO) da LGPD: pode ser o próprio titular. */
  encarregado: '[PREENCHER: nome do encarregado (DPO)]',
  /** Canal exclusivo para pedidos de titular de dados. */
  emailEncarregado: '[PREENCHER: e-mail do encarregado (DPO)]',
  /** Comarca do foro eleito — normalmente a do domicílio do fornecedor. */
  foro: '[PREENCHER: comarca, UF]',
  /** Onde o sistema roda — a LGPD exige dizer para onde vão os dados. */
  hospedagem: '[PREENCHER: onde o sistema é hospedado (provedor e país)]',
} as const

/** Nome comercial do serviço, como aparece nos documentos. */
export const LEGAL_PRODUCT_NAME = 'Hermes'

/** Data da última revisão dos dois documentos (ISO). Mude junto com o texto. */
export const LEGAL_UPDATED_AT = '2026-07-28'

/** Dias entre o cancelamento e o apagamento dos dados da conta. */
export const LEGAL_DELETION_GRACE_DAYS = 30

/** Prazo máximo de resposta a um pedido de titular (LGPD, art. 19, II). */
export const LEGAL_REQUEST_ANSWER_DAYS = 15

/**
 * `true` enquanto o campo for um marcador. As páginas usam isso para destacar o
 * que falta preencher, em vez de publicar `[PREENCHER: CNPJ]` como texto normal.
 */
export function isPlaceholder(value: string): boolean {
  return value.startsWith(PLACEHOLDER_PREFIX)
}

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/**
 * Formata "2026-07-28" como "28 de julho de 2026". Fatia a string em vez de usar
 * `new Date`, que interpretaria a data como UTC e voltaria o dia anterior para
 * quem lê no Brasil. Puro.
 */
export function formatLegalDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  const monthName = MONTHS[Number(month) - 1]
  if (!(year && monthName && day)) return iso
  return `${Number(day)} de ${monthName} de ${year}`
}
