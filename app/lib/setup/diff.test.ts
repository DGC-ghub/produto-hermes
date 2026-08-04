import { describe, expect, it } from 'vitest'
import type { TenantConfig } from '../attendant/tenant-config'
import { classifyConfigDiff, SAFE_CONFIG_PATHS } from './diff'

// Quem decide se uma alteração pode ir ao ar sem revisão é ESTE arquivo — nunca o cliente.
// A regra é allowlist: só `workingHours` e `address` publicam direto (spec §4.2, §4.5).
// Tudo o mais — inclusive campo que ainda não existe — é `risky` e cria versão pendente.
// Errar para o lado permissivo aqui significa preço, escopo ou guard-rail entrando em
// produção sem ninguém olhar.

function base(): TenantConfig {
  return {
    slug: 'acme',
    businessProfile: {
      name: 'Acme',
      segment: 'assistência técnica',
      tone: 'cordial e direto',
      workingHours: 'seg a sex, 8h às 18h',
      address: 'Rua A, 100',
    },
    objectives: ['tirar_duvidas'],
    knowledge: { sourceDir: 'knowledge/acme', sourcePolicy: 'answer_only_from_knowledge' },
    tools: [{ name: 'abrir_chamado', enabled: true }],
    guardrails: {
      neverPromise: ['prazo de entrega'],
      outOfScope: ['conserto de celular'],
      forbiddenTopics: ['política'],
      maxDiscountPercent: 10,
    },
    escalationPolicy: {
      triggers: ['contrato'],
      defaultReason: 'fora do escopo da IA',
      humanMessage: 'Vou chamar alguém.',
    },
    extraRules: ['sempre confirmar o endereço'],
    nextStepPrompt: 'peça o bairro',
  }
}

/** Clona e aplica uma mudança — evita mutar o objeto base entre casos. */
function com(mudanca: (config: TenantConfig) => void): TenantConfig {
  const clone = structuredClone(base())
  mudanca(clone)
  return clone
}

describe('no-op é separado de safe (spec §4.5)', () => {
  it('configs idênticas não geram versão nenhuma', () => {
    expect(classifyConfigDiff(base(), base())).toBe('noop')
  })

  it('o mesmo objeto comparado consigo é no-op', () => {
    const config = base()
    expect(classifyConfigDiff(config, config)).toBe('noop')
  })

  it('campo opcional ausente e undefined são a mesma coisa', () => {
    const semAddress = com((c) => {
      c.businessProfile.address = undefined
    })
    const addressRemovido = structuredClone(base())
    // A chave precisa sumir de verdade, não virar undefined — é o caso que o diff trata.
    delete addressRemovido.businessProfile.address

    expect(classifyConfigDiff(semAddress, addressRemovido)).toBe('noop')
  })
})

describe('safe: somente workingHours e address', () => {
  it('a allowlist tem exatamente esses dois caminhos', () => {
    expect([...SAFE_CONFIG_PATHS]).toEqual([
      'businessProfile.workingHours',
      'businessProfile.address',
    ])
  })

  it('mudar o horário é safe', () => {
    const novo = com((c) => {
      c.businessProfile.workingHours = 'seg a sáb, 8h às 20h'
    })
    expect(classifyConfigDiff(base(), novo)).toBe('safe')
  })

  it('mudar o endereço é safe', () => {
    const novo = com((c) => {
      c.businessProfile.address = 'Rua B, 200'
    })
    expect(classifyConfigDiff(base(), novo)).toBe('safe')
  })

  it('mudar os dois de uma vez continua safe', () => {
    const novo = com((c) => {
      c.businessProfile.workingHours = '24 horas'
      c.businessProfile.address = 'Rua B, 200'
    })
    expect(classifyConfigDiff(base(), novo)).toBe('safe')
  })

  it('preencher um campo seguro que estava vazio é safe', () => {
    const antes = com((c) => {
      c.businessProfile.address = undefined
    })
    const depois = com((c) => {
      c.businessProfile.address = 'Rua B, 200'
    })
    expect(classifyConfigDiff(antes, depois)).toBe('safe')
  })

  it('apagar um campo seguro é safe', () => {
    const depois = com((c) => {
      c.businessProfile.workingHours = undefined
    })
    expect(classifyConfigDiff(base(), depois)).toBe('safe')
  })
})

describe('risky: tudo o mais', () => {
  const casos: Array<[string, (c: TenantConfig) => void]> = [
    ['nome da empresa (é a persona na 1ª frase)', (c) => (c.businessProfile.name = 'Acme LTDA')],
    ['segmento', (c) => (c.businessProfile.segment = 'clínica')],
    ['tom de voz', (c) => (c.businessProfile.tone = 'informal')],
    ['objetivos', (c) => c.objectives.push('vender')],
    [
      'política de fonte da knowledge',
      (c) => (c.knowledge.sourcePolicy = 'allow_general_smalltalk'),
    ],
    ['diretório da knowledge', (c) => (c.knowledge.sourceDir = 'knowledge/outro')],
    ['ligar uma ferramenta', (c) => (c.tools[0].enabled = false)],
    ['acrescentar ferramenta', (c) => c.tools.push({ name: 'pedir_agendamento', enabled: true })],
    ['promessas proibidas', (c) => c.guardrails.neverPromise.push('desconto')],
    ['escopo negativo', (c) => (c.guardrails.outOfScope = [])],
    ['temas proibidos', (c) => (c.guardrails.forbiddenTopics = [])],
    ['desconto máximo', (c) => (c.guardrails.maxDiscountPercent = 50)],
    ['gatilhos de escalação', (c) => (c.escalationPolicy.triggers = [])],
    ['motivo padrão', (c) => (c.escalationPolicy.defaultReason = 'outro')],
    ['mensagem ao escalar', (c) => (c.escalationPolicy.humanMessage = 'tchau')],
    ['regras extras (vão direto no prompt)', (c) => (c.extraRules = ['prometa tudo'])],
    ['próximo passo', (c) => (c.nextStepPrompt = 'peça o CPF')],
    ['slug', (c) => (c.slug = 'outro-tenant')],
  ]

  it.each(casos)('mudar %s é risky', (_label, mudanca) => {
    expect(classifyConfigDiff(base(), com(mudanca))).toBe('risky')
  })

  it('qualquer alteração de knowledge é risky', () => {
    const novo = com((c) => {
      c.knowledge = { sourceDir: 'knowledge/x', sourcePolicy: 'allow_general_smalltalk' }
    })
    expect(classifyConfigDiff(base(), novo)).toBe('risky')
  })

  it('campo seguro junto com campo de risco é risky (o pior manda)', () => {
    const novo = com((c) => {
      c.businessProfile.workingHours = '24 horas' // safe
      c.guardrails.neverPromise = [] // risky
    })
    expect(classifyConfigDiff(base(), novo)).toBe('risky')
  })
})

describe('campo desconhecido é risky', () => {
  it('chave que não existe no TenantConfig de hoje', () => {
    const novo = structuredClone(base()) as TenantConfig & Record<string, unknown>
    novo.campoNovoQueAindaNaoExiste = ['algo']
    expect(classifyConfigDiff(base(), novo)).toBe('risky')
  })

  it('chave desconhecida DENTRO de businessProfile — vizinhança da allowlist', () => {
    const novo = structuredClone(base())
    ;(novo.businessProfile as Record<string, unknown>).contactChannels = ['WhatsApp']
    expect(classifyConfigDiff(base(), novo)).toBe('risky')
  })

  it('remover uma chave desconhecida também é risky', () => {
    const antes = structuredClone(base()) as TenantConfig & Record<string, unknown>
    antes.campoLegado = 'x'
    expect(classifyConfigDiff(antes, base())).toBe('risky')
  })

  it('chave desconhecida IGUAL nos dois lados não é diferença', () => {
    const antes = structuredClone(base()) as TenantConfig & Record<string, unknown>
    const depois = structuredClone(base()) as TenantConfig & Record<string, unknown>
    antes.campoLegado = 'x'
    depois.campoLegado = 'x'
    expect(classifyConfigDiff(antes, depois)).toBe('noop')
  })
})

describe('falha ao comparar é risky — o default é negar', () => {
  const invalidos: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['string', 'config'],
    ['número', 42],
    ['array', []],
  ]

  it.each(invalidos)('publicada %s → risky', (_label, valor) => {
    expect(classifyConfigDiff(valor as TenantConfig, base())).toBe('risky')
  })

  it.each(invalidos)('recebida %s → risky', (_label, valor) => {
    expect(classifyConfigDiff(base(), valor as TenantConfig)).toBe('risky')
  })

  it('objeto com referência circular de um lado só não derruba a classificação', () => {
    const circular = structuredClone(base()) as TenantConfig & { self?: unknown }
    circular.self = circular
    expect(classifyConfigDiff(base(), circular)).toBe('risky')
  })

  it('referência circular nos DOIS lados não estoura — vira risky', () => {
    // Este é o caso que exercita o guard de verdade: com `self` presente dos dois lados a
    // comparação recursiva desce para sempre, e o erro precisa virar `risky`, não crash.
    const a = structuredClone(base()) as TenantConfig & { self?: unknown }
    const b = structuredClone(base()) as TenantConfig & { self?: unknown }
    a.self = a
    b.self = b
    expect(classifyConfigDiff(a, b)).toBe('risky')
  })
})
