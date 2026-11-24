import { describe, expect, it } from 'vitest'
import type { FixedReply } from './attendant/tenant-config'
import { matchFixedReply } from './fixed-replies'

const respostas: FixedReply[] = [
  { id: 'preco', triggers: ['quanto custa', 'preço'], reply: 'R$ 690 por mês.' },
  {
    id: 'golpe',
    triggers: ['golpe'],
    reply: 'Pergunta justa!',
    escalateIfRepeated: true,
  },
  { id: 'parar', triggers: ['parar'], reply: 'Combinado.', register: true },
]

describe('matchFixedReply', () => {
  it('devolve o texto EXATO da config, sem reescrever', () => {
    const achou = matchFixedReply(respostas, 'Quanto custa?', undefined)
    expect(achou?.reply).toBe('R$ 690 por mês.')
    expect(achou?.id).toBe('preco')
    expect(achou?.escalate).toBe(false)
  })

  it('ignora acento e caixa', () => {
    expect(matchFixedReply(respostas, 'QUAL O PRECO?', undefined)?.id).toBe('preco')
  })

  it('sem gatilho, sem resposta fixa', () => {
    expect(matchFixedReply(respostas, 'oi, tudo bem?', undefined)).toBeNull()
  })

  it('sem lista, sem resposta fixa', () => {
    expect(matchFixedReply(undefined, 'quanto custa', undefined)).toBeNull()
  })

  it('insistência: a mesma resposta de novo vira transbordo', () => {
    const achou = matchFixedReply(respostas, 'isso é golpe mesmo', 'Pergunta justa!')
    expect(achou?.escalate).toBe(true)
  })

  it('primeira vez não escala', () => {
    expect(matchFixedReply(respostas, 'isso é golpe?', 'Olá!')?.escalate).toBe(false)
  })

  it('register vem junto', () => {
    expect(matchFixedReply(respostas, 'quero parar', undefined)?.register).toBe(true)
  })
})
