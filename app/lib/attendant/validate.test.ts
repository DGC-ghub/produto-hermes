import { describe, expect, it } from 'vitest'
import { validateAttendantOutput } from './validate'

const good = {
  reply: 'Oi! Posso te ajudar com isso. Qual o equipamento?',
  needsHuman: false,
  handoffReason: null,
  leadPatch: { need: 'geladeira parou' },
  confidence: 0.8,
}

describe('validateAttendantOutput', () => {
  it('aceita uma saída bem formada', () => {
    const result = validateAttendantOutput(good)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.reply).toContain('ajudar')
    }
  })

  it('rejeita não-objeto', () => {
    expect(validateAttendantOutput('x').ok).toBe(false)
    expect(validateAttendantOutput(null).ok).toBe(false)
    expect(validateAttendantOutput([]).ok).toBe(false)
  })

  it('rejeita reply vazio', () => {
    expect(validateAttendantOutput({ ...good, reply: '   ' }).ok).toBe(false)
  })

  it('rejeita reply com bloco de código', () => {
    expect(validateAttendantOutput({ ...good, reply: 'use isto: ```algo```' }).ok).toBe(false)
  })

  it('rejeita vazamento de segredo ou comando', () => {
    expect(validateAttendantOutput({ ...good, reply: 'sua chave e sk-abc123def' }).ok).toBe(false)
    expect(validateAttendantOutput({ ...good, reply: 'veja em /home/pi/segredos' }).ok).toBe(false)
  })

  it('rejeita promessa proibida', () => {
    expect(validateAttendantOutput({ ...good, reply: 'fica conserto garantido!' }).ok).toBe(false)
  })

  it('exige motivo quando needsHuman é true', () => {
    expect(validateAttendantOutput({ ...good, needsHuman: true, handoffReason: null }).ok).toBe(
      false,
    )
    expect(
      validateAttendantOutput({ ...good, needsHuman: true, handoffReason: 'tema sensivel' }).ok,
    ).toBe(true)
  })

  it('zera handoffReason quando needsHuman é false', () => {
    const result = validateAttendantOutput({ ...good, needsHuman: false, handoffReason: 'x' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.handoffReason).toBeNull()
    }
  })

  it('ignora chave de lead não permitida sem perder a resposta', () => {
    const result = validateAttendantOutput({
      ...good,
      leadPatch: { foo: 'bar', need: 'troca de tela' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.leadPatch).toEqual({ need: 'troca de tela' })
    }
  })

  it('clampa confidence fora de [0,1] sem perder a resposta', () => {
    const high = validateAttendantOutput({ ...good, confidence: 1.5 })
    expect(high.ok).toBe(true)
    if (high.ok) {
      expect(high.value.confidence).toBe(1)
    }
    const low = validateAttendantOutput({ ...good, confidence: -0.1 })
    expect(low.ok).toBe(true)
    if (low.ok) {
      expect(low.value.confidence).toBe(0)
    }
    const nan = validateAttendantOutput({ ...good, confidence: Number.NaN })
    expect(nan.ok).toBe(true)
    if (nan.ok) {
      expect(nan.value.confidence).toBe(0.5)
    }
  })

  it('aceita action abrir_chamado válida', () => {
    const result = validateAttendantOutput({
      ...good,
      action: {
        type: 'abrir_chamado',
        subject: 'guia de novembro',
        description: 'preciso da guia',
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.action?.type).toBe('abrir_chamado')
    }
  })

  it('descarta action inventada (vira null) sem invalidar a resposta', () => {
    const result = validateAttendantOutput({ ...good, action: { type: 'fazer_pix', valor: 999 } })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.action).toBeNull()
    }
  })

  it('descarta ação de tool não habilitada para o tenant', () => {
    const action = { type: 'abrir_chamado', subject: 's', description: 'd' }
    const result = validateAttendantOutput({ ...good, action }, { tools: [] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.action).toBeNull()
    }
  })

  it('descarta ação com categoria fora de allowedCategories', () => {
    const action = { type: 'abrir_chamado', subject: 's', description: 'd', category: 'xpto' }
    const policy = {
      tools: [{ name: 'abrir_chamado', limits: { allowedCategories: ['documento', 'guia'] } }],
    }
    const result = validateAttendantOutput({ ...good, action }, policy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.action).toBeNull()
    }
  })

  it('aceita ação com categoria dentro de allowedCategories', () => {
    const action = { type: 'abrir_chamado', subject: 's', description: 'd', category: 'guia' }
    const policy = {
      tools: [{ name: 'abrir_chamado', limits: { allowedCategories: ['documento', 'guia'] } }],
    }
    const result = validateAttendantOutput({ ...good, action }, policy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.action?.category).toBe('guia')
    }
  })

  it('descarta ação faltando um campo obrigatório (requiredFields)', () => {
    const action = { type: 'abrir_chamado', subject: 's', description: 'd' }
    const policy = {
      tools: [{ name: 'abrir_chamado', limits: { requiredFields: ['category'] } }],
    }
    const result = validateAttendantOutput({ ...good, action }, policy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.action).toBeNull()
    }
  })
})
