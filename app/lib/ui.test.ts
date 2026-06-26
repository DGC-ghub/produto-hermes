import { describe, expect, it } from 'vitest'
import {
  autonomyPercent,
  avatarColor,
  conversationStatusMeta,
  cx,
  initials,
  statusMeta,
} from './ui'

describe('cx', () => {
  it('junta classes e ignora valores falsy', () => {
    expect(cx('a', false, 'b', null, undefined, 'c')).toBe('a b c')
  })
})

describe('initials', () => {
  it('usa a primeira e a última inicial', () => {
    expect(initials('Maria Helena Souza')).toBe('MS')
  })

  it('usa duas letras de um nome único', () => {
    expect(initials('Hermes')).toBe('HE')
  })

  it('ignora espaços extras', () => {
    expect(initials('  João   Castro ')).toBe('JC')
  })

  it('retorna ? para um nome vazio', () => {
    expect(initials('   ')).toBe('?')
  })
})

describe('avatarColor', () => {
  it('é determinístico para o mesmo seed', () => {
    expect(avatarColor('Maria')).toBe(avatarColor('Maria'))
  })

  it('retorna uma das classes conhecidas', () => {
    expect(['bg-brand', 'bg-brand-deep', 'bg-ai', 'bg-waiting']).toContain(avatarColor('xyz'))
  })
})

describe('statusMeta', () => {
  it('mapeia urgente para o ponto vermelho', () => {
    expect(statusMeta('urgent')).toEqual({ label: 'precisa de humano', dot: 'bg-urgent' })
  })

  it('usa a cor da marca para resolvido', () => {
    expect(statusMeta('resolved').dot).toBe('bg-brand')
  })
})

describe('autonomyPercent', () => {
  it('devolve null sem conversas (evita 0/0)', () => {
    expect(autonomyPercent(0, 0)).toBeNull()
  })

  it('calcula a fatia resolvida sem humano e arredonda', () => {
    expect(autonomyPercent(10, 2)).toBe(80)
    expect(autonomyPercent(3, 1)).toBe(67)
  })

  it('chega a 100% quando nenhuma envolveu humano', () => {
    expect(autonomyPercent(8, 0)).toBe(100)
  })
})

describe('conversationStatusMeta', () => {
  it('escala o needs_human para o ponto urgente', () => {
    expect(conversationStatusMeta('needs_human')).toEqual({
      label: 'precisa de humano',
      dot: 'bg-urgent',
    })
  })

  it('mostra "IA no ar" quando o Hermes está cuidando (open)', () => {
    expect(conversationStatusMeta('open').dot).toBe('bg-ai')
  })

  it('mostra "em atendimento" quando o humano assumiu', () => {
    expect(conversationStatusMeta('human').label).toBe('em atendimento')
  })

  it('trata encerrada/resolvida com a cor da marca', () => {
    expect(conversationStatusMeta('closed').dot).toBe('bg-brand')
    expect(conversationStatusMeta('resolvido').label).toBe('encerrado')
  })

  it('faz fallback legível para status desconhecido', () => {
    expect(conversationStatusMeta('qualquer_coisa')).toEqual({
      label: 'qualquer_coisa',
      dot: 'bg-ink-soft',
    })
  })
})
