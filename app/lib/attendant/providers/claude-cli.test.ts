import { describe, expect, it } from 'vitest'
import type { AttendantInput } from '../types'
import { buildPrompt, parseClaudeJson } from './claude-cli.server'

const input: AttendantInput = {
  tenant: { slug: 'assistencia-tecnica-demo', name: 'ResolveTech' },
  companyRules: ['não prometa preço fechado'],
  knowledge: [{ title: 'Bairros', snippet: 'Atendemos Centro e Jardim América' }],
  history: [{ role: 'user', content: 'oi' }],
  lead: { name: null, phone: null, neighborhood: 'Centro', need: null, urgency: null },
  myTickets: [],
  message: 'minha geladeira parou',
}

describe('buildPrompt', () => {
  it('inclui empresa, regras, base e a mensagem do cliente', () => {
    const prompt = buildPrompt(input)
    expect(prompt).toContain('ResolveTech')
    expect(prompt).toContain('não prometa preço fechado')
    expect(prompt).toContain('Jardim América')
    expect(prompt).toContain('minha geladeira parou')
  })

  it('delimita a mensagem do cliente como dados', () => {
    expect(buildPrompt(input)).toContain('"""minha geladeira parou"""')
  })
})

describe('parseClaudeJson', () => {
  const good =
    '{"reply":"ok","needsHuman":false,"handoffReason":null,"leadPatch":null,"confidence":0.8}'

  it('lê JSON puro', () => {
    expect((parseClaudeJson(good) as { reply: string }).reply).toBe('ok')
  })

  it('lê JSON dentro de cercas markdown', () => {
    const fenced = `\`\`\`json\n${good}\n\`\`\``
    expect((parseClaudeJson(fenced) as { confidence: number }).confidence).toBe(0.8)
  })

  it('ignora texto ao redor do JSON', () => {
    const noisy = `Claro, aqui está:\n${good}\nespero ter ajudado`
    expect((parseClaudeJson(noisy) as { reply: string }).reply).toBe('ok')
  })

  it('lança erro quando não há JSON', () => {
    expect(() => parseClaudeJson('sem json aqui')).toThrow()
  })
})
