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

  it('inclui a regra de abrir chamado só após confirmação', () => {
    const rules = buildCompanyRules(configWith())
    expect(rules.some((r) => r.includes('DEPOIS que o cliente confirmar'))).toBe(true)
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
})
