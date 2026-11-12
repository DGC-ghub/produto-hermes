import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadTenantConfig } from '../attendant/tenant-config'
import { decideHandoff } from '../handoff'

const cfg = loadTenantConfig('clinica-demo')
const triggers = cfg.escalationPolicy.triggers
const decide = (message: string) =>
  decideHandoff({ message, retrievedCount: 2, extraSensitiveTriggers: triggers })

describe('tenant clinica-demo', () => {
  it('é fictício e só responde com base na base', () => {
    expect(cfg.businessProfile.name).toMatch(/demo/i)
    expect(cfg.knowledge.sourcePolicy).toBe('answer_only_from_knowledge')
    expect(readdirSync('knowledge/clinica-demo').length).toBeGreaterThanOrEqual(4)
  })

  it.each([
    'estou com dor de dente',
    'meu rosto está com inchaço',
    'posso tomar remédio antes?',
    'saiu o resultado do exame?',
    'vocês aceitam plano de saúde?',
    'quero reembolso',
    'foi urgência aqui',
    'quero falar com um atendente',
  ])('"%s" vai para a recepção (no balcão, não no prompt)', (msg) => {
    expect(decide(msg).needsHuman).toBe(true)
  })

  it.each([
    'quero marcar uma limpeza',
    'qual o horário de sábado?',
    'quanto custa o clareamento?',
  ])('"%s" segue com a IA', (msg) => {
    expect(decide(msg).needsHuman).toBe(false)
  })

  it('não pede nem guarda dado sensível por regra', () => {
    expect(cfg.extraRules?.join(' ')).toMatch(/Nunca peça CPF/)
  })
})
