import { describe, expect, it } from 'vitest'
import { buildCompanyRules } from './rules'
import { safeDefaultConfig, type TenantConfig } from './tenant-config'

function configWith(overrides: Partial<TenantConfig['businessProfile']> = {}): TenantConfig {
  const base = safeDefaultConfig('demo')
  return {
    ...base,
    businessProfile: {
      name: 'ResolveTech',
      segment: 'assistência técnica',
      tone: 'curto e cordial',
      workingHours: 'Seg-Sex 8h-18h',
      ...overrides,
    },
  }
}

// `safeDefaultConfig` nasce com `tools: []` — quem quer a regra de chamado precisa
// ligar a ferramenta, igual ao tenant real.
function withTicketTool(config: TenantConfig): TenantConfig {
  return { ...config, tools: [{ name: 'abrir_chamado', enabled: true }] }
}

describe('buildCompanyRules', () => {
  it('injeta a persona do tenant (nome, segmento, tom, horário)', () => {
    const rules = buildCompanyRules(configWith()).join('\n')
    expect(rules).toContain('ResolveTech')
    expect(rules).toContain('assistência técnica')
    expect(rules).toContain('curto e cordial')
    expect(rules).toContain('Seg-Sex 8h-18h')
  })

  it('omite o horário quando não informado', () => {
    const rules = buildCompanyRules(configWith({ workingHours: undefined })).join('\n')
    expect(rules).toContain('ResolveTech')
    expect(rules).not.toContain('Horário de funcionamento')
  })

  it('inclui a regra de abrir chamado só após confirmação (tenant COM a ferramenta)', () => {
    const rules = buildCompanyRules(withTicketTool(configWith()))
    expect(rules.some((r) => r.includes('DEPOIS que o cliente confirmar'))).toBe(true)
    expect(rules.some((r) => r.includes('abrir_chamado'))).toBe(true)
  })

  // Tenant novo (`/signup`) e fallback de config nascem com `tools: []`: mandar o
  // modelo "incluir a action abrir_chamado" ali só produz promessa que ninguém cumpre.
  it('não manda abrir chamado quando a ferramenta não está habilitada', () => {
    const rules = buildCompanyRules(configWith())
    expect(rules.some((r) => r.includes('abrir_chamado'))).toBe(false)
    expect(rules.some((r) => r.includes('DEPOIS que o cliente confirmar'))).toBe(false)
  })

  it('sem a ferramenta, orienta a não afirmar registro e a oferecer uma pessoa', () => {
    const rules = buildCompanyRules(configWith())
    const semTool = rules.find((r) => r.includes('não registra chamados'))
    expect(semTool).toBeDefined()
    expect(semTool).toContain('NUNCA diga que registrou')
    expect(semTool).toContain('pessoa do time')
  })

  it('ferramenta presente mas desligada conta como ausente', () => {
    const config: TenantConfig = {
      ...configWith(),
      tools: [{ name: 'abrir_chamado', enabled: false }],
    }
    expect(buildCompanyRules(config).some((r) => r.includes('abrir_chamado'))).toBe(false)
  })

  it('inclui a regra de segurar e converter (não escalar por atrito leve)', () => {
    const rules = buildCompanyRules(configWith())
    expect(rules.some((r) => r.includes('atrito leve'))).toBe(true)
  })

  it('anexa as regras livres da empresa (extraRules)', () => {
    const base = safeDefaultConfig('demo')
    const config: TenantConfig = { ...base, extraRules: ['Pergunte sempre o bairro.'] }
    expect(buildCompanyRules(config)).toContain('Pergunte sempre o bairro.')
  })

  it('injeta a regra de escopo negativo (recusar-e-seguir) quando há outOfScope', () => {
    const base = safeDefaultConfig('demo')
    const config: TenantConfig = {
      ...base,
      guardrails: { neverPromise: [], outOfScope: ['micro-ondas', 'forno'] },
    }
    const scopeRule = buildCompanyRules(config).find((r) => r.includes('NÃO atende'))
    expect(scopeRule).toBeDefined()
    expect(scopeRule).toContain('micro-ondas')
    expect(scopeRule).toContain('forno')
    // "recusar-e-seguir": manda seguir ajudando, não escalar.
    expect(scopeRule).toContain('siga ajudando')
  })

  it('não injeta regra de escopo quando outOfScope está ausente/vazio', () => {
    expect(buildCompanyRules(configWith()).some((r) => r.includes('NÃO atende'))).toBe(false)
    const base = safeDefaultConfig('demo')
    const empty: TenantConfig = { ...base, guardrails: { neverPromise: [], outOfScope: [] } }
    expect(buildCompanyRules(empty).some((r) => r.includes('NÃO atende'))).toBe(false)
  })
})
