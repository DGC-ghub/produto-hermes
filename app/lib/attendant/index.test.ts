import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeProviderName, generateAttendantReply, providerNameFromEnv } from './index'
import { mockProvider } from './providers/mock'
import type { AttendantInput, AttendantProvider } from './types'

const baseInput: AttendantInput = {
  tenant: { slug: 'dgc', name: 'DGC Hub' },
  companyRules: [],
  enabledTools: [],
  knowledge: [],
  history: [],
  lead: null,
  myTickets: [],
  message: 'oi, tudo bem?',
}

afterEach(() => vi.unstubAllEnvs())

describe('seleção do provider — configuração inválida nunca vira mock', () => {
  it('aceita apenas os três nomes explícitos', () => {
    expect(providerNameFromEnv('claude_cli', 'production')).toBe('claude_cli')
    expect(providerNameFromEnv('anthropic_api', 'production')).toBe('anthropic_api')
    expect(providerNameFromEnv('mock', 'production')).toBe('mock')
  })

  it('recusa nome desconhecido e provider ausente em produção', () => {
    expect(() => providerNameFromEnv('claude_clii', 'production')).toThrow('desconhecido')
    expect(() => providerNameFromEnv(undefined, 'production')).toThrow('obrigatório')
  })

  it('rotula configuração inválida sem quebrar a telemetria', () => {
    vi.stubEnv('ATTENDANT_PROVIDER', 'claude_clii')
    expect(activeProviderName()).toBe('invalid')
  })

  it('configuração inválida cai no fallback seguro, não no mock', async () => {
    vi.stubEnv('ATTENDANT_PROVIDER', 'claude_clii')
    const out = await generateAttendantReply(baseInput)
    expect(out.needsHuman).toBe(true)
    expect(out.handoffReason).toBe('provider_error')
    expect(out.reply).not.toContain(baseInput.message)
  })
})

describe('generateAttendantReply', () => {
  it('devolve saída válida com o provider mock', async () => {
    const out = await generateAttendantReply(baseInput, { provider: mockProvider })
    expect(out.reply.length).toBeGreaterThan(0)
    expect(typeof out.needsHuman).toBe('boolean')
    expect(out.confidence).toBeGreaterThanOrEqual(0)
  })

  it('escala para humano quando o cliente pede', async () => {
    const out = await generateAttendantReply(
      { ...baseInput, message: 'quero falar com um humano' },
      { provider: mockProvider },
    )
    expect(out.needsHuman).toBe(true)
    expect(out.handoffReason).toBeTruthy()
  })

  it('cai em fallback seguro se o provider falha', async () => {
    const broken: AttendantProvider = {
      name: 'broken',
      async generate() {
        throw new Error('boom')
      },
    }
    const out = await generateAttendantReply(baseInput, { provider: broken })
    expect(out.needsHuman).toBe(true)
    expect(out.handoffReason).toBe('provider_error')
  })

  it('cai em fallback seguro se o provider devolve algo inválido', async () => {
    const junk: AttendantProvider = {
      name: 'junk',
      async generate() {
        return { reply: '' } as unknown as Awaited<ReturnType<AttendantProvider['generate']>>
      },
    }
    const out = await generateAttendantReply(baseInput, { provider: junk })
    expect(out.needsHuman).toBe(true)
    expect(out.handoffReason).toBe('validacao_falhou')
  })

  it('descarta ação de tool não habilitada para o tenant (allowedTools)', async () => {
    const ticketProvider: AttendantProvider = {
      name: 'ticket',
      async generate() {
        return {
          reply: 'vou registrar',
          needsHuman: false,
          handoffReason: null,
          leadPatch: null,
          confidence: 0.5,
          action: { type: 'abrir_chamado', subject: 's', description: 'd' },
        }
      },
    }
    const semTool = await generateAttendantReply(baseInput, {
      provider: ticketProvider,
      policy: { tools: [] },
    })
    expect(semTool.action).toBeNull()

    const comTool = await generateAttendantReply(baseInput, {
      provider: ticketProvider,
      policy: { tools: [{ name: 'abrir_chamado' }] },
    })
    expect(comTool.action?.type).toBe('abrir_chamado')
  })
})
