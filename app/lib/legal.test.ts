import { describe, expect, it } from 'vitest'
import {
  formatLegalDate,
  isPlaceholder,
  LEGAL_DELETION_GRACE_DAYS,
  LEGAL_ENTITY,
  LEGAL_REQUEST_ANSWER_DAYS,
  LEGAL_UPDATED_AT,
} from './legal'

describe('LEGAL_ENTITY', () => {
  it('não deixa nenhum campo vazio', () => {
    for (const [campo, valor] of Object.entries(LEGAL_ENTITY)) {
      expect(valor.trim().length, campo).toBeGreaterThan(0)
    }
  })

  it('todo campo pendente é reconhecível por isPlaceholder', () => {
    // Invariante que sobrevive ao preenchimento: quem editar não pode inventar
    // outro formato de marcador (ex.: "preencher CNPJ"), senão o dado pendente
    // sai na tela como texto normal, sem o realce que avisa que falta preencher.
    for (const [campo, valor] of Object.entries(LEGAL_ENTITY)) {
      if (valor.toUpperCase().includes('PREENCHER')) {
        expect(isPlaceholder(valor), campo).toBe(true)
      }
    }
  })
})

describe('isPlaceholder', () => {
  it('reconhece o marcador e ignora o dado real', () => {
    expect(isPlaceholder('[PREENCHER: CNPJ ou CPF]')).toBe(true)
    expect(isPlaceholder('12.345.678/0001-90')).toBe(false)
    expect(isPlaceholder('')).toBe(false)
  })
})

describe('formatLegalDate', () => {
  it('escreve a data por extenso em português', () => {
    expect(formatLegalDate('2026-07-28')).toBe('28 de julho de 2026')
    expect(formatLegalDate('2026-03-01')).toBe('1 de março de 2026')
  })

  it('mantém o dia mesmo em datas que viram o mês em UTC', () => {
    // `new Date('2026-01-01')` seria meia-noite UTC = 31/12 no Brasil. Aqui não.
    expect(formatLegalDate('2026-01-01')).toBe('1 de janeiro de 2026')
  })

  it('devolve a entrada quando ela não é uma data ISO', () => {
    expect(formatLegalDate('ontem')).toBe('ontem')
    expect(formatLegalDate('2026-13-01')).toBe('2026-13-01')
  })
})

describe('constantes dos documentos', () => {
  it('mantém a data de atualização em ISO', () => {
    expect(LEGAL_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(formatLegalDate(LEGAL_UPDATED_AT)).not.toBe(LEGAL_UPDATED_AT)
  })

  it('mantém os prazos em dias inteiros e positivos', () => {
    for (const dias of [LEGAL_DELETION_GRACE_DAYS, LEGAL_REQUEST_ANSWER_DAYS]) {
      expect(Number.isInteger(dias)).toBe(true)
      expect(dias).toBeGreaterThan(0)
    }
  })
})
