import { describe, expect, it } from 'vitest'
import { loadTenantConfig, parseTenantConfig, serializeTenantConfig } from './tenant-config'

describe('loadTenantConfig', () => {
  it('carrega o config da Prestacon do arquivo', () => {
    const config = loadTenantConfig('prestacon')
    expect(config.slug).toBe('prestacon')
    expect(config.businessProfile.name).toBe('Prestacon Contabilidade')
    expect(config.knowledge.sourceDir).toBe('knowledge/prestacon')
    expect(config.tools.find((t) => t.name === 'abrir_chamado')?.enabled).toBe(true)
  })

  it('carrega os 3 tenants iniciais', () => {
    for (const slug of ['dgc', 'assistencia-tecnica-demo', 'prestacon']) {
      expect(loadTenantConfig(slug).slug).toBe(slug)
    }
  })

  it('rejeita slug inseguro (path traversal)', () => {
    expect(() => loadTenantConfig('../dgc')).toThrow('Invalid tenant slug')
  })

  it('rejeita tenant inexistente', () => {
    expect(() => loadTenantConfig('empresa-que-nao-existe')).toThrow('não encontrado')
  })
})

describe('parseTenantConfig', () => {
  const valid = {
    businessProfile: { name: 'X', segment: 'y', tone: 'z' },
    objectives: ['tirar_duvidas'],
    knowledge: { sourceDir: 'knowledge/x', sourcePolicy: 'allow_general_smalltalk' },
    tools: [{ name: 'abrir_chamado', enabled: true }],
    guardrails: { neverPromise: [] },
    escalationPolicy: { triggers: [], defaultReason: 'r', humanMessage: 'm' },
  }

  it('aceita um config bem formado', () => {
    expect(parseTenantConfig('x', valid).businessProfile.name).toBe('X')
  })

  it('rejeita objeto sem businessProfile', () => {
    const { businessProfile, ...rest } = valid
    expect(() => parseTenantConfig('x', rest)).toThrow()
  })

  it('rejeita sourcePolicy inválido', () => {
    expect(() =>
      parseTenantConfig('x', { ...valid, knowledge: { sourceDir: 'k', sourcePolicy: 'qualquer' } }),
    ).toThrow('sourcePolicy')
  })

  it('normaliza opcionais ausentes sem quebrar', () => {
    const config = parseTenantConfig('x', valid)
    expect(config.guardrails.forbiddenTopics).toBeUndefined()
    expect(config.extraRules).toBeUndefined()
  })
})

describe('serializeTenantConfig', () => {
  it('faz roundtrip: serialize → parse devolve o mesmo config', () => {
    const config = loadTenantConfig('dgc')
    const back = parseTenantConfig('dgc', JSON.parse(serializeTenantConfig(config)))
    expect(back).toEqual(config)
  })

  it('não grava o slug dentro do JSON (vem do nome do arquivo)', () => {
    const config = loadTenantConfig('dgc')
    expect(JSON.parse(serializeTenantConfig(config))).not.toHaveProperty('slug')
  })
})
