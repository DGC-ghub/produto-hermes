import { describe, expect, it } from 'vitest'
import {
  isReadyToSubmit,
  isStepComplete,
  MIN_LIST_ITEM_CHARS,
  MIN_TEXT_CHARS,
  missingFieldsByStep,
  parseAnswers,
  SETUP_FIELDS,
  SETUP_STEPS,
  type SetupAnswers,
  setupProgress,
} from './answers'

// As respostas do questionário são a ÚNICA entrada do cliente no onboarding — ele nunca
// escreve configuração técnica. Por isso a validação de completude vive aqui, pura e
// testada, e a rota apenas a consulta: se a regra morasse na tela, um POST direto passaria
// por cima dela (spec §5.1).
//
// Os mínimos não são capricho: "a" ou "-" num campo obrigatório passariam por "preenchido"
// e o job geraria uma configuração baseada em nada.

/** Respostas completas — ponto de partida que cada teste degrada de propósito. */
function completas(): SetupAnswers {
  const answers: SetupAnswers = {}
  for (const field of SETUP_FIELDS) {
    answers[field.key] =
      field.kind === 'list'
        ? ['um item suficientemente descritivo', 'outro item']
        : 'uma resposta com folga acima do mínimo exigido'
  }
  return answers
}

describe('catálogo de campos (spec §5)', () => {
  it('tem as quatro etapas na ordem da spec', () => {
    expect([...SETUP_STEPS]).toEqual(['empresa', 'servicos', 'operacao', 'seguranca'])
  })

  it('todo campo pertence a uma etapa conhecida', () => {
    for (const field of SETUP_FIELDS) {
      expect(SETUP_STEPS).toContain(field.step)
    }
  })

  it('as chaves são únicas', () => {
    const keys = SETUP_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('a etapa de segurança é INTEIRA obrigatória', () => {
    // É a etapa que protege o cliente do próprio produto: gatilhos de escalação, o que
    // nunca prometer, o que nunca pedir. Deixar qualquer parte opcional esvazia a promessa.
    const seguranca = SETUP_FIELDS.filter((f) => f.step === 'seguranca')
    expect(seguranca.length).toBeGreaterThanOrEqual(5)
    expect(seguranca.every((f) => f.required)).toBe(true)
  })

  it('não pergunta campo que o motor não lê', () => {
    // objectives, forbiddenTopics, maxDiscountPercent e defaultReason não têm consumidor
    // no motor — perguntá-los gastaria a paciência do cliente sem mudar nada (spec §5).
    const proibidos = ['objectives', 'forbiddenTopics', 'maxDiscountPercent', 'defaultReason']
    for (const key of SETUP_FIELDS.map((f) => f.key)) {
      expect(proibidos).not.toContain(key)
    }
  })

  it('cada etapa tem pelo menos um campo obrigatório', () => {
    for (const step of SETUP_STEPS) {
      const daEtapa = SETUP_FIELDS.filter((f) => f.step === step)
      expect(daEtapa.some((f) => f.required)).toBe(true)
    }
  })
})

describe('completude de texto', () => {
  it(`aceita texto com ${MIN_TEXT_CHARS} caracteres ou mais`, () => {
    const answers = completas()
    answers.nome = 'x'.repeat(MIN_TEXT_CHARS)
    expect(isReadyToSubmit(answers)).toBe(true)
  })

  it('recusa texto curto demais', () => {
    const answers = completas()
    answers.nome = 'x'.repeat(MIN_TEXT_CHARS - 1)
    expect(isReadyToSubmit(answers)).toBe(false)
  })

  it('recusa preenchimento simbólico', () => {
    for (const lixo of ['a', '-', 'x', '   ', '...', '\n\n']) {
      const answers = completas()
      answers.nome = lixo
      expect(isReadyToSubmit(answers)).toBe(false)
    }
  })

  it('espaço em branco não conta para o mínimo', () => {
    const answers = completas()
    answers.nome = `  ${'x'.repeat(MIN_TEXT_CHARS - 1)}  `
    expect(isReadyToSubmit(answers)).toBe(false)
  })
})

describe('completude de lista', () => {
  it(`aceita ao menos um item com ${MIN_LIST_ITEM_CHARS} caracteres`, () => {
    const answers = completas()
    answers.servicosOferecidos = ['x'.repeat(MIN_LIST_ITEM_CHARS)]
    expect(isReadyToSubmit(answers)).toBe(true)
  })

  it('recusa lista vazia', () => {
    const answers = completas()
    answers.servicosOferecidos = []
    expect(isReadyToSubmit(answers)).toBe(false)
  })

  it('recusa lista só com itens curtos ou em branco', () => {
    const answers = completas()
    answers.servicosOferecidos = ['a', ' ', 'xy']
    expect(isReadyToSubmit(answers)).toBe(false)
  })

  it('um item bom entre itens ruins basta', () => {
    const answers = completas()
    answers.servicosOferecidos = ['a', 'conserto de geladeira', ' ']
    expect(isReadyToSubmit(answers)).toBe(true)
  })
})

describe('campos opcionais não bloqueiam', () => {
  it('opcional vazio não impede a submissão', () => {
    const answers = completas()
    for (const field of SETUP_FIELDS.filter((f) => !f.required)) {
      answers[field.key] = field.kind === 'list' ? [] : ''
    }
    expect(isReadyToSubmit(answers)).toBe(true)
  })

  it('mas todo obrigatório ausente bloqueia', () => {
    for (const field of SETUP_FIELDS.filter((f) => f.required)) {
      const answers = completas()
      delete answers[field.key]
      expect(isReadyToSubmit(answers)).toBe(false)
    }
  })
})

describe('completude por etapa e progresso', () => {
  it('etapa completa quando seus obrigatórios estão preenchidos', () => {
    const answers = completas()
    for (const step of SETUP_STEPS) {
      expect(isStepComplete(step, answers)).toBe(true)
    }
  })

  it('esvaziar um obrigatório derruba só a etapa dele', () => {
    const answers = completas()
    answers.nome = '' // etapa 'empresa'
    expect(isStepComplete('empresa', answers)).toBe(false)
    expect(isStepComplete('servicos', answers)).toBe(true)
    expect(isStepComplete('operacao', answers)).toBe(true)
    expect(isStepComplete('seguranca', answers)).toBe(true)
  })

  it('progresso é etapas completas sobre quatro', () => {
    expect(setupProgress({})).toEqual({ done: 0, total: 4 })
    expect(setupProgress(completas())).toEqual({ done: 4, total: 4 })
  })

  it('progresso avança etapa a etapa', () => {
    const answers = completas()
    answers.nome = ''
    answers.servicosOferecidos = []
    expect(setupProgress(answers)).toEqual({ done: 2, total: 4 })
  })

  it('missingFieldsByStep diz exatamente o que falta', () => {
    const answers = completas()
    answers.nome = ''
    answers.servicosOferecidos = []

    const faltando = missingFieldsByStep(answers)
    expect(faltando.empresa).toContain('nome')
    expect(faltando.servicos).toContain('servicosOferecidos')
    expect(faltando.operacao).toEqual([])
    expect(faltando.seguranca).toEqual([])
  })
})

describe('parseAnswers tolera o que vem do banco', () => {
  it('JSON vazio vira objeto vazio', () => {
    expect(parseAnswers('{}')).toEqual({})
  })

  it('JSON inválido não derruba a tela — vira vazio', () => {
    // O campo é texto no banco; um registro corrompido não pode impedir o cliente de
    // reabrir o questionário.
    expect(parseAnswers('{ isto não é json')).toEqual({})
    expect(parseAnswers(null)).toEqual({})
    expect(parseAnswers(undefined)).toEqual({})
    expect(parseAnswers('[]')).toEqual({})
    expect(parseAnswers('"texto"')).toEqual({})
  })

  it('descarta chave desconhecida', () => {
    const parsed = parseAnswers(JSON.stringify({ nome: 'Acme LTDA e filiais', invasor: 'x' }))
    expect(parsed.nome).toBe('Acme LTDA e filiais')
    expect(parsed).not.toHaveProperty('invasor')
  })

  it('normaliza tipo trocado: texto onde se espera lista e vice-versa', () => {
    const parsed = parseAnswers(
      JSON.stringify({ nome: ['virou', 'lista'], servicosOferecidos: 'virou texto' }),
    )
    expect(typeof parsed.nome).toBe('string')
    expect(Array.isArray(parsed.servicosOferecidos)).toBe(true)
  })

  it('limpa itens em branco das listas', () => {
    const parsed = parseAnswers(JSON.stringify({ servicosOferecidos: ['  ', 'conserto', ''] }))
    expect(parsed.servicosOferecidos).toEqual(['conserto'])
  })

  it('sobrevive a valores não-textuais', () => {
    const parsed = parseAnswers(JSON.stringify({ nome: 42, servicosOferecidos: [1, null, 'ok'] }))
    expect(parsed.nome).toBe('')
    expect(parsed.servicosOferecidos).toEqual(['ok'])
  })
})
