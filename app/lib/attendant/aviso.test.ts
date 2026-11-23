import { describe, expect, it } from 'vitest'
import { avisoAssistente, comAvisoDeAssistente } from './aviso'

const config = {
  avisoAssistente: true,
  businessProfile: { name: 'Clínica X', segment: 's', tone: 't' },
}

describe('comAvisoDeAssistente', () => {
  it('acrescenta o aviso fixo na 1ª mensagem', () => {
    const r = comAvisoDeAssistente('Posso ajudar?', { config, primeiraMensagem: true })
    expect(r).toBe(`${avisoAssistente('Clínica X')} Posso ajudar?`)
    expect(r).toContain('assistente virtual')
  })
  it('não acrescenta depois da 1ª mensagem', () => {
    expect(comAvisoDeAssistente('Oi', { config, primeiraMensagem: false })).toBe('Oi')
  })
  it('não acrescenta se o tenant não liga o aviso', () => {
    const c = { ...config, avisoAssistente: undefined }
    expect(comAvisoDeAssistente('Oi', { config: c, primeiraMensagem: true })).toBe('Oi')
  })
  it('não repete se a resposta já se apresenta (com ou sem acento/caixa)', () => {
    const reply = 'Oi! Sou a Assistente Virtual da clínica.'
    expect(comAvisoDeAssistente(reply, { config, primeiraMensagem: true })).toBe(reply)
  })
})
