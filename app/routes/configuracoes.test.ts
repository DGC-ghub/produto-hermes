import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantConfig } from '../lib/attendant/tenant-config'

// `guardrails.outOfScope` é guard-rail DETERMINÍSTICO: alimenta a regra do prompt
// (rules.ts) e o descarte de action pelo validador (validate.ts). A tela de configurações
// não o edita — mas salvava sem preservá-lo, então qualquer "Salvar" apagava o escopo
// negativo da empresa em silêncio. Estes testes prendem a preservação dos campos que a
// tela NÃO mostra.

const OPERATOR = {
  accountId: 'acc-1',
  username: 'dono@acme.com',
  role: 'owner',
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
}

// Config atual do tenant — o que estava salvo antes do "Salvar".
let current: TenantConfig
// O que a action mandou persistir.
let saved: TenantConfig | null = null

vi.mock('../lib/auth.server', () => ({
  requireOwner: vi.fn(async () => OPERATOR),
}))

vi.mock('../lib/attendant/tenant-config-db.server', () => ({
  resolveTenantConfig: vi.fn(async () => current),
  saveTenantConfigToDb: vi.fn(async (config: TenantConfig) => {
    saved = config
  }),
}))

import { action } from './configuracoes'

function baseConfig(): TenantConfig {
  return {
    slug: 'acme',
    businessProfile: {
      name: 'Acme',
      segment: 'assistência técnica',
      tone: 'cordial e direto',
      workingHours: 'seg a sex, 8h às 18h',
    },
    objectives: ['tirar_duvidas'],
    knowledge: { sourceDir: 'knowledge/acme', sourcePolicy: 'answer_only_from_knowledge' },
    tools: [{ name: 'abrir_chamado', enabled: true }],
    guardrails: {
      neverPromise: ['prazo de entrega'],
      // Os três campos que a tela NÃO edita e que precisam sobreviver ao salvar:
      outOfScope: ['conserto de celular', 'instalação elétrica'],
      forbiddenTopics: ['política'],
      maxDiscountPercent: 10,
    },
    escalationPolicy: {
      triggers: ['contrato'],
      defaultReason: 'fora do escopo da IA',
      humanMessage: 'Vou chamar alguém do time para te ajudar.',
    },
    extraRules: ['sempre confirmar o endereço'],
  }
}

/** Formulário como a tela envia: só os campos que ela mostra. */
function formDaTela(over: Record<string, string> = {}): FormData {
  const form = new FormData()
  const campos: Record<string, string> = {
    name: 'Acme',
    segment: 'assistência técnica',
    tone: 'cordial e direto',
    workingHours: 'seg a sex, 8h às 18h',
    address: '',
    sourcePolicy: 'answer_only_from_knowledge',
    neverPromise: 'prazo de entrega',
    triggers: 'contrato',
    defaultReason: 'fora do escopo da IA',
    humanMessage: 'Vou chamar alguém do time para te ajudar.',
    extraRules: 'sempre confirmar o endereço',
    ...over,
  }
  for (const [key, value] of Object.entries(campos)) {
    form.append(key, value)
  }
  form.append('objectives', 'tirar_duvidas')
  form.append('tool_abrir_chamado', 'on')
  return form
}

function salvar(form: FormData) {
  return action({
    request: new Request('https://h/configuracoes', { method: 'POST', body: form }),
  } as Parameters<typeof action>[0])
}

beforeEach(() => {
  vi.clearAllMocks()
  current = baseConfig()
  saved = null
})

describe('/configuracoes — salvar não pode apagar o que a tela não edita', () => {
  it('preserva guardrails.outOfScope', async () => {
    const result = await salvar(formDaTela())

    expect(result).toMatchObject({ ok: true })
    expect(saved).not.toBeNull()
    // O escopo negativo é determinístico: perdê-lo faz a IA aceitar serviço que a
    // empresa não presta, sem nenhum erro visível.
    expect(saved?.guardrails.outOfScope).toEqual(['conserto de celular', 'instalação elétrica'])
  })

  it('continua preservando forbiddenTopics e maxDiscountPercent', async () => {
    await salvar(formDaTela())

    expect(saved?.guardrails.forbiddenTopics).toEqual(['política'])
    expect(saved?.guardrails.maxDiscountPercent).toBe(10)
  })

  it('não inventa outOfScope quando o tenant não tem nenhum', async () => {
    current = baseConfig()
    current.guardrails = { neverPromise: ['prazo de entrega'] }

    await salvar(formDaTela())

    expect(saved?.guardrails.outOfScope).toBeUndefined()
    expect(saved?.guardrails.forbiddenTopics).toBeUndefined()
    expect(saved?.guardrails.maxDiscountPercent).toBeUndefined()
  })

  it('grava normalmente o que a tela EDITA, sem regressão', async () => {
    await salvar(formDaTela({ neverPromise: 'prazo de entrega\ndesconto sem aprovação' }))

    expect(saved?.guardrails.neverPromise).toEqual(['prazo de entrega', 'desconto sem aprovação'])
    expect(saved?.businessProfile.name).toBe('Acme')
    expect(saved?.escalationPolicy.triggers).toEqual(['contrato'])
  })
})
