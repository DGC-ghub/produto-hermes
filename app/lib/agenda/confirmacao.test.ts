import { describe, expect, it } from 'vitest'
import { appointmentsToConfirm, confirmationMessage, parseConfirmationReply } from './confirmacao'
import type { Appointment } from './types'

const base = { patientRef: 'paciente-1', service: 'Limpeza', status: 'agendado' } as const
const ap = (
  id: string,
  start: string,
  status: Appointment['status'] = 'agendado',
): Appointment => ({
  ...base,
  id,
  start,
  end: start,
  status,
})

describe('appointmentsToConfirm', () => {
  it('pega só os agendados do dia seguinte (fuso de Brasília)', () => {
    const list = [
      ap('hoje', '2026-11-17T15:00:00-03:00'),
      ap('amanha', '2026-11-18T09:00:00-03:00'),
      ap('amanha-confirmado', '2026-11-18T10:00:00-03:00', 'confirmado'),
      ap('amanha-cancelado', '2026-11-18T11:00:00-03:00', 'cancelado'),
      ap('depois', '2026-11-19T09:00:00-03:00'),
    ]
    const r = appointmentsToConfirm(list, '2026-11-17T17:00:00-03:00')
    expect(r.map((a) => a.id)).toEqual(['amanha'])
  })

  it('usa o dia de Brasília mesmo com relógio em UTC (noite)', () => {
    // 23:30 em Brasília = 02:30 UTC do dia seguinte; "amanhã" continua sendo dia 18
    const r = appointmentsToConfirm(
      [ap('a', '2026-11-18T09:00:00-03:00')],
      '2026-11-18T02:30:00.000Z',
    )
    expect(r.map((a) => a.id)).toEqual(['a'])
  })
})

describe('parseConfirmationReply', () => {
  it.each([
    ['sim', 'confirmar'],
    ['Confirmo!', 'confirmar'],
    ['1', 'confirmar'],
    ['não vou poder', 'remarcar'],
    ['preciso remarcar', 'remarcar'],
    ['2', 'remarcar'],
    ['cancelar', 'cancelar'],
    ['3', 'cancelar'],
  ])('"%s" -> %s', (text, esperado) => {
    expect(parseConfirmationReply(text)).toBe(esperado)
  })

  it('o que não entende vai para a recepção, nunca confirma por chute', () => {
    expect(parseConfirmationReply('estou com dor de dente')).toBe('humano')
    expect(parseConfirmationReply('sim mas queria saber o preço')).toBe('humano')
    expect(parseConfirmationReply('')).toBe('humano')
  })
})

describe('confirmationMessage', () => {
  it('avisa que é assistente virtual e oferece 3 respostas; sem dado de saúde', () => {
    const m = confirmationMessage(ap('x', '2026-11-18T09:00:00-03:00'), 'Clínica Demo')
    expect(m).toContain('assistente virtual')
    expect(m).toContain('18/11')
    expect(m).toContain('09:00')
    expect(m).toMatch(/1.*2.*3/s)
  })
})
