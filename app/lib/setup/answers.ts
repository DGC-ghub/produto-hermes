// As respostas do questionário de onboarding (spec §5). PURO: sem banco, sem I/O.
//
// Este é o único lugar onde o cliente escreve. Ele nunca edita `TenantConfig`, prompt,
// tools ou base de conhecimento — responde perguntas em português comum, e o job traduz.
// Por isso o catálogo de campos aqui é a fonte da verdade: a tela é derivada dele, e a
// validação de completude é consultada tanto pela tela quanto pelo servidor (§5.1).

export const SETUP_STEPS = ['empresa', 'servicos', 'operacao', 'seguranca'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]

export type FieldKind = 'text' | 'list'

export type FieldDef = {
  key: string
  step: SetupStep
  kind: FieldKind
  required: boolean
  /** Rótulo como o cliente lê — sem jargão. */
  label: string
  /** Uma frase de ajuda; aparece abaixo do campo. */
  help?: string
  placeholder?: string
}

// Mínimos de preenchimento. Não são capricho: "a", "-" ou "x" passariam por "preenchido"
// e o job geraria configuração a partir de nada.
export const MIN_TEXT_CHARS = 15
export const MIN_LIST_ITEM_CHARS = 3

/**
 * Catálogo dos campos. A coluna "Vira" da spec §5 fica com o job (etapa 5) — aqui só
 * existe o que o CLIENTE vê e responde.
 *
 * Campos sem consumidor no motor (`objectives`, `forbiddenTopics`, `maxDiscountPercent`,
 * `escalationPolicy.defaultReason`) NÃO são perguntados: gastariam a paciência de quem
 * responde sem mudar nada no atendimento.
 */
export const SETUP_FIELDS: readonly FieldDef[] = [
  // ── A. Empresa e público ──────────────────────────────────────────────
  {
    key: 'nome',
    step: 'empresa',
    kind: 'text',
    required: true,
    label: 'Qual é o nome da empresa?',
    help: 'É como a IA vai se apresentar na primeira frase.',
    placeholder: 'Ex.: Clínica Bem Estar',
  },
  {
    key: 'segmento',
    step: 'empresa',
    kind: 'text',
    required: true,
    label: 'Em que ramo ela atua?',
    placeholder: 'Ex.: clínica de fisioterapia',
  },
  {
    key: 'oQueFaz',
    step: 'empresa',
    kind: 'text',
    required: true,
    label: 'O que a empresa faz, em duas ou três frases?',
    help: 'Explique como você explicaria para um cliente novo no balcão.',
  },
  {
    key: 'tipoDeCliente',
    step: 'empresa',
    kind: 'text',
    required: false,
    label: 'Quem são seus clientes?',
    placeholder: 'Ex.: famílias do bairro, empresas pequenas…',
  },
  {
    key: 'regiaoAtendida',
    step: 'empresa',
    kind: 'text',
    required: true,
    label: 'Em quais cidades ou regiões vocês atendem?',
    help: 'Serve para a IA recusar pedido de fora da área em vez de prometer.',
  },

  // ── B. Serviços e condições ───────────────────────────────────────────
  {
    key: 'servicosOferecidos',
    step: 'servicos',
    kind: 'list',
    required: true,
    label: 'Quais serviços vocês oferecem?',
    help: 'Um por linha.',
  },
  {
    key: 'servicosNaoOferecidos',
    step: 'servicos',
    kind: 'list',
    required: true,
    label: 'O que vocês NÃO fazem?',
    help: 'Um por linha. É o que impede a IA de aceitar serviço que vocês não prestam.',
  },
  {
    key: 'comoContratar',
    step: 'servicos',
    kind: 'text',
    required: true,
    label: 'Como o cliente contrata?',
    placeholder: 'Ex.: marca uma avaliação, depois assina a proposta…',
  },
  {
    key: 'precos',
    step: 'servicos',
    kind: 'text',
    required: false,
    label: 'Quais preços a IA pode informar?',
    help: 'Deixe em branco se não quiser que ela fale de preço — assim ela nunca inventa um.',
  },
  {
    key: 'condicoesComerciais',
    step: 'servicos',
    kind: 'text',
    required: false,
    label: 'Existem condições ou limites comerciais?',
    placeholder: 'Ex.: parcelamos em até 3x; desconto só com aprovação',
  },

  // ── C. Operação ───────────────────────────────────────────────────────
  {
    key: 'horario',
    step: 'operacao',
    kind: 'text',
    required: true,
    label: 'Qual é o horário de atendimento?',
    placeholder: 'Ex.: seg a sex, das 8h às 18h',
  },
  {
    key: 'canaisDeContato',
    step: 'operacao',
    kind: 'list',
    required: false,
    label: 'Que outros canais vocês usam?',
    help: 'Um por linha — telefone, e-mail, endereço…',
  },
  {
    key: 'prazoDeResposta',
    step: 'operacao',
    kind: 'text',
    required: false,
    label: 'Em quanto tempo vocês costumam responder?',
  },
  {
    key: 'informacoesDaTriagem',
    step: 'operacao',
    kind: 'text',
    required: true,
    label: 'Que informações a IA pode pedir ao cliente?',
    help: 'Ex.: nome, bairro, o que está acontecendo. Só o necessário para atender.',
  },
  {
    key: 'proximoPasso',
    step: 'operacao',
    kind: 'text',
    required: true,
    label: 'O que deve acontecer no fim de um bom atendimento?',
    placeholder: 'Ex.: agendar uma visita; passar para a recepção',
  },

  // ── D. Segurança e handoff (INTEIRA obrigatória) ──────────────────────
  {
    key: 'assuntosSensiveis',
    step: 'seguranca',
    kind: 'list',
    required: true,
    label: 'Que assuntos precisam de uma pessoa, sempre?',
    help: 'Um por linha. A IA para e chama você em vez de responder.',
  },
  {
    key: 'nuncaPrometer',
    step: 'seguranca',
    kind: 'list',
    required: true,
    label: 'O que a IA nunca pode prometer?',
    help: 'Um por linha — prazo, resultado, desconto…',
  },
  {
    key: 'nuncaPedir',
    step: 'seguranca',
    kind: 'list',
    required: true,
    label: 'Que informações ela nunca deve pedir?',
    help: 'Um por linha — ex.: dados de cartão, senha, documento.',
  },
  {
    key: 'quandoChamarHumano',
    step: 'seguranca',
    kind: 'text',
    required: true,
    label: 'Em que situações ela deve chamar você?',
  },
  {
    key: 'foraDeEscopo',
    step: 'seguranca',
    kind: 'list',
    required: true,
    label: 'Que pedidos estão fora do escopo?',
    help: 'Um por linha. A IA recusa educadamente em vez de aceitar.',
  },
]

export type SetupAnswers = Record<string, string | string[]>

const FIELD_BY_KEY = new Map(SETUP_FIELDS.map((field) => [field.key, field]))

function textFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length >= MIN_TEXT_CHARS
}

function listFilled(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some((item) => typeof item === 'string' && item.trim().length >= MIN_LIST_ITEM_CHARS)
  )
}

/** O campo está preenchido de forma útil? Pura. */
export function isFieldFilled(field: FieldDef, answers: SetupAnswers): boolean {
  const value = answers[field.key]
  return field.kind === 'list' ? listFilled(value) : textFilled(value)
}

/** Todos os obrigatórios desta etapa estão preenchidos? Pura. */
export function isStepComplete(step: SetupStep, answers: SetupAnswers): boolean {
  return SETUP_FIELDS.filter((field) => field.step === step && field.required).every((field) =>
    isFieldFilled(field, answers),
  )
}

/** Dá para enviar para revisão? Pura — o servidor consulta isto antes de aceitar o POST. */
export function isReadyToSubmit(answers: SetupAnswers): boolean {
  return SETUP_STEPS.every((step) => isStepComplete(step, answers))
}

/** Quantas etapas estão completas. Pura — a barra de progresso deriva daqui, não de contador. */
export function setupProgress(answers: SetupAnswers): { done: number; total: number } {
  return {
    done: SETUP_STEPS.filter((step) => isStepComplete(step, answers)).length,
    total: SETUP_STEPS.length,
  }
}

/** O que falta, por etapa — é o que a tela mostra e o que o servidor devolve ao recusar. */
export function missingFieldsByStep(answers: SetupAnswers): Record<SetupStep, string[]> {
  const out = {} as Record<SetupStep, string[]>
  for (const step of SETUP_STEPS) {
    out[step] = SETUP_FIELDS.filter(
      (field) => field.step === step && field.required && !isFieldFilled(field, answers),
    ).map((field) => field.key)
  }
  return out
}

/**
 * Lê `answersJson` do banco tolerando lixo: registro corrompido não pode impedir o cliente
 * de reabrir o questionário. Descarta chave desconhecida (o JSON é gravado pelo servidor,
 * mas não custa não confiar), normaliza tipo trocado e limpa itens em branco das listas.
 */
export function parseAnswers(raw: unknown): SetupAnswers {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {}
  }

  const source = parsed as Record<string, unknown>
  const out: SetupAnswers = {}
  for (const [key, value] of Object.entries(source)) {
    const field = FIELD_BY_KEY.get(key)
    if (!field) {
      continue // chave desconhecida: descarta
    }
    if (field.kind === 'list') {
      out[key] = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
    } else {
      out[key] = typeof value === 'string' ? value : ''
    }
  }
  return out
}

/** Serializa para o banco, mantendo só campos conhecidos. Pura. */
export function serializeAnswers(answers: SetupAnswers): string {
  return JSON.stringify(parseAnswers(answers))
}
