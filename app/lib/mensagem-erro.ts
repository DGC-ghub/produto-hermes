// Tradução de falha técnica para uma frase que o dono de uma PME entende — e que diz
// O QUE FAZER, não o que quebrou. Nasceu de erros crus vazando pra tela do cliente
// ("TenantConfig.businessProfile.tone", "SESSION_SECRET é obrigatório em produção"):
// isso não estraga só a experiência, estraga a confiança de quem está avaliando o produto.
//
// IMPORTANTE — esta função NÃO substitui o log. A mensagem técnica original continua
// indo pro `console.error` do servidor no ponto onde o erro é capturado (é dela que a
// depuração vive); o que muda é só o que o CLIENTE vê. O padrão no ponto de uso é:
//
//   catch (error) {
//     console.error('[configuracoes] falha ao salvar', error) // técnico → servidor
//     return { error: mensagemAmigavel(error) }               // humano → tela
//   }
//
// Função pura: sem banco, sem fs, sem I/O.

// Rótulos como a TELA chama cada campo do TenantConfig (espelha /configuracoes). O erro
// fala em caminho de dado; o cliente só reconhece o nome do campo que ele preencheu.
const FIELD_LABELS: Record<string, string> = {
  'businessProfile.name': 'Nome',
  'businessProfile.segment': 'Segmento',
  'businessProfile.tone': 'Tom de voz',
  'businessProfile.workingHours': 'Horário de atendimento',
  'businessProfile.address': 'Endereço',
  'knowledge.sourcePolicy': 'Política de resposta',
  'knowledge.sourceDir': 'Base de conhecimento',
  'escalationPolicy.defaultReason': 'Motivo padrão',
  'escalationPolicy.humanMessage': 'Mensagem ao cliente ao escalar',
  'escalationPolicy.triggers': 'Gatilhos de escalação',
  businessProfile: 'Perfil da empresa',
  knowledge: 'Base de conhecimento',
  escalationPolicy: 'Escalação para humano',
  guardrails: 'Guard-rails e regras',
  objectives: 'Objetivos',
  tools: 'Ferramentas',
  extraRules: 'Regras extras',
}

const MESSAGES = {
  // O cliente não tem o que preencher aqui — a ação útil é avisar quem opera.
  systemConfig:
    'Falta uma configuração do sistema para concluir isso. Já registramos o erro — avise o suporte se continuar acontecendo.',
  connection:
    'Não conseguimos falar com o servidor agora. Confira sua conexão e tente de novo em instantes.',
  database:
    'Nossa base de dados não respondeu agora. Tente de novo em instantes; se continuar, avise o suporte.',
  duplicate:
    'Já existe um registro com essas informações. Mude o que está repetido e salve de novo.',
  linked:
    'Esse item depende de outro registro que não existe mais. Atualize a página e tente de novo.',
  notFound:
    'Não encontramos esse item — ele pode ter sido removido. Atualize a página e tente de novo.',
  requiredGeneric: 'Faltou preencher um campo obrigatório. Confira o formulário e salve de novo.',
  fallback: 'Não conseguimos salvar agora. Tente de novo em instantes.',
} as const

// Nome de variável de ambiente: MAIÚSCULAS com underscore (SESSION_SECRET, DATABASE_URL).
const ENV_VAR = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/
const ENV_MISSING =
  /(obrigatori|ausente|faltando|nao definid|nao encontrad|missing|not found|not set|required)/
const ENV_WORDS = /(variavel de ambiente|environment variable)/

// Códigos de rede do Node (`error.code`) e frases típicas de falha de conexão.
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
])
const CONNECTION_WORDS =
  /(fetch failed|socket hang up|network error|connection refused|connect timeout|timed out|esgotou o tempo)/
// O código de rede costuma vir também dentro da mensagem ("connect ECONNREFUSED 127.0.0.1"),
// e some do `error.code` quando alguém reembrulha o erro no caminho.
const CONNECTION_IN_TEXT =
  /\b(econnrefused|econnreset|etimedout|enotfound|eai_again|ehostunreach|enetunreach)\b/

const NOT_FOUND_WORDS = /(nao encontrad|nao existe|not found|does not exist|no such)/

// Validação de campo: em português o motor diz "deve ser…", "precisa de…", "inválido".
const VALIDATION_WORDS = /(obrigatori|nao-vazia|nao vazia|precisa de|deve ser|invalid[oa])/

// Caminho do campo dentro do TenantConfig (ex.: "TenantConfig.businessProfile.tone deve ser…").
const CONFIG_FIELD = /TenantConfig\.([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)/

// Prisma sinaliza a família do erro pelo código (P1001 = banco fora, P2002 = duplicado…).
const PRISMA_CODE = /^P\d{4}$/
const PRISMA_BY_CODE: Record<string, string> = {
  P1000: MESSAGES.database, // autenticação no banco
  P1001: MESSAGES.database, // banco inalcançável
  P1002: MESSAGES.database, // timeout no banco
  P1008: MESSAGES.database, // operação estourou o tempo
  P1017: MESSAGES.database, // conexão encerrada pelo servidor
  P2002: MESSAGES.duplicate,
  P2003: MESSAGES.linked, // foreign key
  P2014: MESSAGES.linked, // relação obrigatória
  P2001: MESSAGES.notFound,
  P2025: MESSAGES.notFound,
}

function readMessage(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object') {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') {
      return message
    }
  }
  return ''
}

function readCode(value: unknown): string {
  if (value && typeof value === 'object') {
    const code = (value as { code?: unknown }).code
    if (typeof code === 'string' || typeof code === 'number') {
      return String(code)
    }
  }
  return ''
}

// Sem acento e em minúsculas: o mesmo erro chega ora em português, ora em inglês.
function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function fieldMessage(raw: string): string | null {
  const path = CONFIG_FIELD.exec(raw)?.[1]
  if (!path) {
    return null
  }
  const label = FIELD_LABELS[path]
  if (!label) {
    return MESSAGES.requiredGeneric
  }
  return path.includes('.')
    ? `Preencha o campo "${label}" antes de salvar.`
    : `Confira a seção "${label}" — faltou uma informação obrigatória.`
}

/**
 * Traduz uma falha técnica na frase que o cliente vê. Reconhece as famílias comuns
 * (campo obrigatório/validação de config, variável de ambiente ausente, falha de conexão,
 * erro do Prisma, registro inexistente) e, para o que não reconhece, devolve uma frase
 * genérica digna. NUNCA repassa a mensagem crua — o texto de saída é sempre nosso.
 */
export function mensagemAmigavel(erro: unknown): string {
  // `fetch failed` guarda o motivo real na causa; olhamos um nível abaixo antes de decidir.
  const cause = erro && typeof erro === 'object' ? (erro as { cause?: unknown }).cause : undefined
  const raw = `${readMessage(erro)} ${readMessage(cause)}`.trim()
  const text = normalize(raw)
  const code = readCode(erro) || readCode(cause)

  // 1. Variável de ambiente ausente. Vem antes de tudo porque o texto ("é obrigatório")
  // também casaria com validação de campo — e aí mandaríamos o dono preencher um formulário
  // que não tem esse campo.
  if (ENV_WORDS.test(text) || (ENV_VAR.test(raw) && ENV_MISSING.test(text))) {
    return MESSAGES.systemConfig
  }

  // 2. Prisma: o código é mais confiável que a mensagem (que muda de versão pra versão).
  if (PRISMA_CODE.test(code)) {
    return PRISMA_BY_CODE[code] ?? MESSAGES.database
  }

  if (CONNECTION_CODES.has(code) || CONNECTION_WORDS.test(text) || CONNECTION_IN_TEXT.test(text)) {
    return MESSAGES.connection
  }

  if (NOT_FOUND_WORDS.test(text)) {
    return MESSAGES.notFound
  }

  const field = fieldMessage(raw)
  if (field) {
    return field
  }
  if (VALIDATION_WORDS.test(text)) {
    return MESSAGES.requiredGeneric
  }

  return MESSAGES.fallback
}
