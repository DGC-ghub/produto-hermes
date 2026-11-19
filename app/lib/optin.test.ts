import { describe, expect, it } from 'vitest'
import {
  deveFazerPerguntaOptIn,
  distribuirEmLotes,
  foiPerguntaOptIn,
  interpretarRespostaOptIn,
  OPT_IN_QUESTION,
  podeReceber,
  seloOptIn,
} from './optin'

describe('interpretarRespostaOptIn', () => {
  it.each([
    'sim',
    'Sim!',
    'quero',
    'quero sim',
    'pode sim',
    'claro',
    'com certeza',
    'aceito',
  ])('"%s" é sim', (t) => expect(interpretarRespostaOptIn(t)).toBe('sim'))
  it.each([
    'não',
    'Nao',
    'não quero',
    'prefiro não',
    'agora não, obrigada',
    'dispenso',
  ])('"%s" é não', (t) => expect(interpretarRespostaOptIn(t)).toBe('nao'))
  it.each([
    'parar',
    'PARAR',
    'sair',
    'pare',
    'stop',
    'quero parar de receber',
    'não quero receber mais',
  ])('"%s" é parar', (t) => expect(interpretarRespostaOptIn(t)).toBe('parar'))
  it.each([
    'qual o endereço?',
    'sim, mas não agora',
    'sim, e qual o valor da limpeza?',
    'amanhã às 10h',
    '',
  ])('"%s" não é resposta', (t) => expect(interpretarRespostaOptIn(t)).toBeNull())
})

describe('podeReceber', () => {
  it('lembrete de consulta marcada pelo paciente passa sem opt-in', () => {
    expect(podeReceber(null, 'lembrete_consulta')).toBe(true)
    expect(podeReceber({ status: null }, 'lembrete_consulta')).toBe(true)
    expect(podeReceber({ status: 'nao' }, 'lembrete_consulta')).toBe(true)
  })
  it('lembrete de consulta que o paciente não marcou não passa por esta regra', () => {
    expect(podeReceber(null, 'lembrete_consulta', { consultaMarcadaPeloPaciente: false })).toBe(
      false,
    )
  })
  it.each(['reativacao', 'followup_marketing'] as const)('%s só com sim', (tipo) => {
    expect(podeReceber({ status: 'sim' }, tipo)).toBe(true)
    expect(podeReceber({ status: 'nao' }, tipo)).toBe(false)
    expect(podeReceber({ status: null }, tipo)).toBe(false)
    expect(podeReceber(null, tipo)).toBe(false)
    expect(podeReceber(undefined, tipo)).toBe(false)
  })
})

describe('distribuirEmLotes', () => {
  const lista = Array.from({ length: 25 }, (_, i) => `c${i}`)
  it('divide por dia respeitando o limite', () => {
    const lotes = distribuirEmLotes(lista, { limiteDiario: 10, inicio: '2026-12-01' })
    expect(lotes.map((l) => [l.dia, l.itens.length])).toEqual([
      ['2026-12-01', 10],
      ['2026-12-02', 10],
      ['2026-12-03', 5],
    ])
    expect(lotes.flatMap((l) => l.itens)).toEqual(lista)
  })
  it('vira o mês e o ano', () => {
    const lotes = distribuirEmLotes(['a', 'b', 'c'], { limiteDiario: 1, inicio: '2026-12-31' })
    expect(lotes.map((l) => l.dia)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02'])
  })
  it('desconta o que já saiu hoje', () => {
    const lotes = distribuirEmLotes(['a', 'b', 'c'], {
      limiteDiario: 2,
      inicio: '2026-12-01',
      jaEnviadosNoPrimeiroDia: 1,
    })
    expect(lotes.map((l) => l.itens.length)).toEqual([1, 2])
  })
  it('primeiro dia cheio começa no dia seguinte', () => {
    const lotes = distribuirEmLotes(['a'], {
      limiteDiario: 2,
      inicio: '2026-12-01',
      jaEnviadosNoPrimeiroDia: 2,
    })
    expect(lotes).toEqual([{ dia: '2026-12-02', itens: ['a'] }])
  })
  it('lista vazia = nenhum lote', () => {
    expect(distribuirEmLotes([], { limiteDiario: 5, inicio: '2026-12-01' })).toEqual([])
  })
  it.each([0, -1, 1.5, Number.NaN])('limite inválido (%s) lança', (limiteDiario) => {
    expect(() => distribuirEmLotes(['a'], { limiteDiario, inicio: '2026-12-01' })).toThrow()
  })
  it('data de início inválida lança', () => {
    expect(() => distribuirEmLotes(['a'], { limiteDiario: 1, inicio: '01/12/2026' })).toThrow()
  })
})

describe('deveFazerPerguntaOptIn', () => {
  const base = { habilitado: true, registro: null, pedidoResolvido: true, precisaHumano: false }
  it('pergunta uma vez, depois do pedido resolvido', () => {
    expect(deveFazerPerguntaOptIn(base)).toBe(true)
  })
  it('não pergunta com a flag desligada', () => {
    expect(deveFazerPerguntaOptIn({ ...base, habilitado: false })).toBe(false)
  })
  it('não pergunta antes de resolver o pedido nem em transbordo', () => {
    expect(deveFazerPerguntaOptIn({ ...base, pedidoResolvido: false })).toBe(false)
    expect(deveFazerPerguntaOptIn({ ...base, precisaHumano: true })).toBe(false)
  })
  it('não pergunta de novo (já perguntado, respondido ou recusado)', () => {
    expect(
      deveFazerPerguntaOptIn({ ...base, registro: { status: null, askedAt: new Date() } }),
    ).toBe(false)
    expect(
      deveFazerPerguntaOptIn({ ...base, registro: { status: 'sim', askedAt: new Date() } }),
    ).toBe(false)
    expect(
      deveFazerPerguntaOptIn({ ...base, registro: { status: 'nao', askedAt: new Date() } }),
    ).toBe(false)
  })
})

describe('foiPerguntaOptIn', () => {
  it('reconhece a pergunta na última fala da assistente', () => {
    expect(foiPerguntaOptIn(`Pronto! Marcada.\n\n${OPT_IN_QUESTION}`)).toBe(true)
    expect(foiPerguntaOptIn('Pronto! Marcada.')).toBe(false)
    expect(foiPerguntaOptIn(undefined)).toBe(false)
  })
})

describe('seloOptIn', () => {
  it('mostra o estado com data de Brasília', () => {
    const d = new Date('2026-12-01T02:30:00Z') // 30/11 23:30 em Brasília
    expect(seloOptIn({ status: 'sim', decidedAt: d })).toBe('Aceitou lembretes em 30/11')
    expect(seloOptIn({ status: 'nao', decidedAt: d })).toBe('Recusou lembretes em 30/11')
    expect(seloOptIn({ status: null, decidedAt: null })).toBe('Ainda não respondeu sobre lembretes')
    expect(seloOptIn(null)).toBeNull()
  })
})
