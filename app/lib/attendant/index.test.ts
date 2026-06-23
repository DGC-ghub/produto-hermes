import { describe, expect, it } from 'vitest'
import { generateAttendantReply } from './index'
import { mockProvider } from './providers/mock'
import type { AttendantInput, AttendantProvider } from './types'

const baseInput: AttendantInput = {
  tenant: { slug: 'dgc', name: 'DGC Hub' },
  companyRules: [],
  knowledge: [],
  history: [],
  lead: null,
  myTickets: [],
  message: 'oi, tudo bem?',
}

describe('generateAttendantReply', () => {
  it('devolve saída válida com o provider mock', async () => {
    const out = await generateAttendantReply(baseInput, mockProvider)
    expect(out.reply.length).toBeGreaterThan(0)
    expect(typeof out.needsHuman).toBe('boolean')
    expect(out.confidence).toBeGreaterThanOrEqual(0)
  })

  it('escala para humano quando o cliente pede', async () => {
    const out = await generateAttendantReply(
      { ...baseInput, message: 'quero falar com um humano' },
      mockProvider,
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
    const out = await generateAttendantReply(baseInput, broken)
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
    const out = await generateAttendantReply(baseInput, junk)
    expect(out.needsHuman).toBe(true)
    expect(out.handoffReason).toBe('validacao_falhou')
  })
})
