import { describe, expect, it } from 'vitest'
import { type AlarmState, decideAlarm, formatAlarm, formatSensitiveAlarm } from './alarm.server'

const COOLDOWN = 10 * 60 * 1000 // 10 min
const fresh: AlarmState = { lastSentAt: null, suppressed: 0 }

describe('decideAlarm', () => {
  it('dispara na primeira falha', () => {
    const d = decideAlarm(1000, fresh, COOLDOWN)
    expect(d.send).toBe(true)
    expect(d.state.lastSentAt).toBe(1000)
  })

  it('suprime falhas dentro do cooldown e conta os suprimidos', () => {
    const first = decideAlarm(1000, fresh, COOLDOWN)
    const second = decideAlarm(1000 + 1000, first.state, COOLDOWN)
    const third = decideAlarm(1000 + 2000, second.state, COOLDOWN)
    expect(second.send).toBe(false)
    expect(third.send).toBe(false)
    expect(third.state.suppressed).toBe(2)
  })

  it('volta a disparar depois do cooldown e reporta os suprimidos acumulados', () => {
    const first = decideAlarm(0, fresh, COOLDOWN)
    const suppressed = decideAlarm(1000, first.state, COOLDOWN) // dentro: suprime (1)
    const after = decideAlarm(COOLDOWN + 1, suppressed.state, COOLDOWN) // fora: dispara
    expect(after.send).toBe(true)
    if (after.send) {
      expect(after.suppressed).toBe(1)
    }
    expect(after.state.suppressed).toBe(0) // zera após disparar
  })
})

describe('formatAlarm', () => {
  it('inclui o motivo', () => {
    expect(formatAlarm('provider_error', 0)).toContain('provider_error')
  })

  it('menciona os suprimidos quando houver', () => {
    expect(formatAlarm('validacao_falhou', 3)).toContain('+3')
  })

  it('não menciona suprimidos quando for zero', () => {
    expect(formatAlarm('provider_error', 0)).not.toContain('suprimida')
  })

  it('falha de ENVIO tem mensagem própria (cliente ficou sem resposta, não fallback)', () => {
    const message = formatAlarm('envio_whatsapp_falhou', 0)
    expect(message).toContain('envio_whatsapp_falhou')
    expect(message).toContain('SEM resposta')
    expect(message).not.toContain('fallback')
  })
})

describe('formatSensitiveAlarm', () => {
  it('identifica o tenant e manda abrir a Central, sem conteúdo da conversa', () => {
    const message = formatSensitiveAlarm('csmed', 0)
    expect(message).toContain('csmed')
    expect(message).toContain('/atendente')
  })

  it('conta as escalações suprimidas no intervalo', () => {
    expect(formatSensitiveAlarm('csmed', 2)).toContain('+2')
  })
})
