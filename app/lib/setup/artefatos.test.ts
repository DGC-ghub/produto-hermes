import { describe, expect, it } from 'vitest'
import {
  CAMPOS_DE_ARTEFATO,
  type CampoDeArtefato,
  montarConfigFinal,
  PERGUNTAS_ESPERADAS,
  validarArtefatos,
} from './artefatos'

// "Válido" tem que significar "o produto conseguiria usar isto".
//
// A versão anterior desta validação aceitava `{"slug":"acme"}` como config — e o
// `parseTenantConfig`, que é o parser que o MOTOR usa, reprova isso na cara. Ou seja: os
// testes chamavam de válido material que faria alguém assumir a revisão de algo
// impossível de carregar.

const SLUG = 'acme'

/**
 * Uma config que o motor CARREGA de verdade — atravessa o `parseTenantConfig` depois de
 * montada. Note o que NÃO está aqui: `slug` e `knowledge.sourceDir`, que o servidor força
 * (§6.7). Uma candidata que os trouxesse seria suspeita, não completa.
 *
 * O shape veio do parser e de `config/tenants/csmed.json`, não de suposição: escrever um
 * fixture "que parece config" foi exatamente o erro que deixou a validação superficial.
 */
function configBoa() {
  return {
    businessProfile: { name: 'Clínica Bem Estar', segment: 'saúde', tone: 'cordial' },
    knowledge: { sourcePolicy: 'answer_only_from_knowledge' },
    guardrails: { neverPromise: ['prazo de exame'] },
    escalationPolicy: {
      triggers: ['dor', 'sangramento'],
      defaultReason: 'tema_de_saude_ou_sensivel',
      humanMessage: 'Vou te encaminhar para nossa equipe.',
    },
    objectives: ['responder dúvidas'],
    tools: [],
  }
}

/** As cinco perguntas do §6.6. */
function perguntasBoas() {
  return Array.from({ length: PERGUNTAS_ESPERADAS }, (_, i) => ({
    id: `q${i + 1}`,
    question: `Pergunta ${i + 1}?`,
    expectedFacts: ['um fato verificável'],
    expectedBehavior: 'responder com o fato, sem prometer além',
    shouldHandoff: false,
  }))
}

function artefatosBons() {
  return {
    candidateConfigJson: JSON.stringify(configBoa()),
    candidateKnowledgeJson: JSON.stringify([{ title: 'FAQ', content: 'Atendemos de 9h às 18h.' }]),
    summaryJson: JSON.stringify({ texto: 'Sua IA vai responder dúvidas sobre horário.' }),
    gapsJson: '[]',
    risksJson: '[]',
    validationJson: JSON.stringify(perguntasBoas()),
  }
}

/** Devolve o motivo do problema num campo, ou undefined se ele passou. */
function motivo(artefatos: Record<string, string | null>, campo: CampoDeArtefato) {
  return validarArtefatos(SLUG, artefatos).find((p) => p.campo === campo)?.motivo
}

describe('conjunto completo e utilizável', () => {
  it('não tem problema nenhum', () => {
    expect(validarArtefatos(SLUG, artefatosBons())).toEqual([])
  })
})

describe('config: passa pelo parser do MOTOR, não por teste de forma', () => {
  it('objeto com um campo qualquer é REPROVADO', () => {
    // O caso concreto: `{"slug":"acme"}` passava antes. O motor não carrega.
    expect(
      motivo({ ...artefatosBons(), candidateConfigJson: '{"slug":"acme"}' }, 'candidateConfigJson'),
    ).toContain('o motor não carregaria')
  })

  it.each([
    ['businessProfile', { ...configBoa(), businessProfile: undefined }],
    ['knowledge', { ...configBoa(), knowledge: undefined }],
    ['guardrails', { ...configBoa(), guardrails: undefined }],
    ['escalationPolicy', { ...configBoa(), escalationPolicy: undefined }],
    [
      'defaultReason da escalação',
      { ...configBoa(), escalationPolicy: { triggers: [], humanMessage: 'x' } },
    ],
    [
      'humanMessage da escalação',
      { ...configBoa(), escalationPolicy: { triggers: [], defaultReason: 'x' } },
    ],
    ['objectives como array', { ...configBoa(), objectives: 'não é array' }],
    ['tools como array', { ...configBoa(), tools: 'não é array' }],
  ])('config sem %s é reprovada', (_rotulo, config) => {
    expect(
      motivo(
        { ...artefatosBons(), candidateConfigJson: JSON.stringify(config) },
        'candidateConfigJson',
      ),
    ).toBeTruthy()
  })

  it('sourcePolicy inventada é reprovada', () => {
    const config = { ...configBoa(), knowledge: { sourcePolicy: 'inventada' } }
    expect(
      motivo(
        { ...artefatosBons(), candidateConfigJson: JSON.stringify(config) },
        'candidateConfigJson',
      ),
    ).toBeTruthy()
  })
})

describe('conhecimento: título e conteúdo, não só um array', () => {
  it('lista vazia é reprovada', () => {
    // Base vazia deixou três dos sete tenants sem nada: o motor cai no fallback em toda
    // pergunta.
    expect(
      motivo({ ...artefatosBons(), candidateKnowledgeJson: '[]' }, 'candidateKnowledgeJson'),
    ).toContain('vazia')
  })

  it('documento sem título é reprovado', () => {
    expect(
      motivo(
        { ...artefatosBons(), candidateKnowledgeJson: JSON.stringify([{ content: 'x' }]) },
        'candidateKnowledgeJson',
      ),
    ).toContain('sem título')
  })

  it('documento sem conteúdo é reprovado', () => {
    expect(
      motivo(
        {
          ...artefatosBons(),
          candidateKnowledgeJson: JSON.stringify([{ title: 'FAQ', content: '  ' }]),
        },
        'candidateKnowledgeJson',
      ),
    ).toContain('sem conteúdo')
  })
})

describe('as cinco perguntas (§6.6)', () => {
  it(`uma pergunta só é reprovada — são ${PERGUNTAS_ESPERADAS}`, () => {
    // Uma lista com uma entrada dava a APARÊNCIA de prova sem cobrir nada.
    expect(
      motivo(
        { ...artefatosBons(), validationJson: JSON.stringify([perguntasBoas()[0]]) },
        'validationJson',
      ),
    ).toContain(`são ${PERGUNTAS_ESPERADAS} perguntas`)
  })

  it('mais que cinco também é reprovado', () => {
    const seis = [...perguntasBoas(), { ...perguntasBoas()[0], id: 'q6' }]
    expect(
      motivo({ ...artefatosBons(), validationJson: JSON.stringify(seis) }, 'validationJson'),
    ).toBeTruthy()
  })

  it.each([
    ['id', 'id'],
    ['question', 'question'],
    ['expectedBehavior', 'expectedBehavior'],
  ])('pergunta sem %s é reprovada', (_rotulo, campo) => {
    const perguntas = perguntasBoas()
    perguntas[2] = { ...perguntas[2], [campo]: '' }
    expect(
      motivo({ ...artefatosBons(), validationJson: JSON.stringify(perguntas) }, 'validationJson'),
    ).toBeTruthy()
  })

  it('expectedFacts vazio é reprovado', () => {
    const perguntas = perguntasBoas()
    perguntas[0] = { ...perguntas[0], expectedFacts: [] }
    expect(
      motivo({ ...artefatosBons(), validationJson: JSON.stringify(perguntas) }, 'validationJson'),
    ).toContain('expectedFacts')
  })

  it('shouldHandoff AUSENTE não vale como false', () => {
    // A diferença entre "não sabemos" e "não deve escalar" é exatamente o que a prova mede.
    const perguntas = perguntasBoas().map(({ shouldHandoff: _, ...resto }) => resto)
    expect(
      motivo({ ...artefatosBons(), validationJson: JSON.stringify(perguntas) }, 'validationJson'),
    ).toContain('shouldHandoff')
  })

  it('id repetido é reprovado', () => {
    const perguntas = perguntasBoas()
    perguntas[1] = { ...perguntas[1], id: 'q1' }
    expect(
      motivo({ ...artefatosBons(), validationJson: JSON.stringify(perguntas) }, 'validationJson'),
    ).toContain('repetido')
  })
})

describe('resumo', () => {
  it('objeto sem texto é reprovado', () => {
    expect(
      motivo({ ...artefatosBons(), summaryJson: '{"outroCampo":1}' }, 'summaryJson'),
    ).toContain('texto')
  })

  it('campos EXTRA são aceitos — o contrato é mínimo de propósito', () => {
    // A spec cita o resumo mas não fixa o formato. Exigir só o indispensável evita travar
    // a etapa 6 num shape inventado aqui.
    const resumo = JSON.stringify({ texto: 'ok', oQueMuda: ['a', 'b'], versao: 2 })
    expect(motivo({ ...artefatosBons(), summaryJson: resumo }, 'summaryJson')).toBeUndefined()
  })
})

describe('lacunas e riscos', () => {
  it('vazios são resultado legítimo', () => {
    // Exigir conteúdo obrigaria o gerador a inventar problema para a revisão começar.
    expect(validarArtefatos(SLUG, { ...artefatosBons(), gapsJson: '[]', risksJson: '[]' })).toEqual(
      [],
    )
  })

  it('item sem descrição é ruído, não achado', () => {
    expect(motivo({ ...artefatosBons(), gapsJson: '[{"campo":"horario"}]' }, 'gapsJson')).toContain(
      'descrição',
    )
  })

  it('objeto onde se espera lista é reprovado', () => {
    expect(motivo({ ...artefatosBons(), risksJson: '{"a":1}' }, 'risksJson')).toContain('lista')
  })
})

describe('ausência e JSON quebrado', () => {
  it.each(CAMPOS_DE_ARTEFATO.map((c) => [c]))('%s nulo é apontado', (campo) => {
    expect(motivo({ ...artefatosBons(), [campo]: null }, campo)).toBe('ausente')
  })

  it.each(CAMPOS_DE_ARTEFATO.map((c) => [c]))('%s com JSON quebrado é apontado', (campo) => {
    expect(motivo({ ...artefatosBons(), [campo]: '{quebrado' }, campo)).toContain('não é JSON')
  })

  it('objeto vazio aponta TODOS os campos', () => {
    expect(validarArtefatos(SLUG, {})).toHaveLength(CAMPOS_DE_ARTEFATO.length)
  })
})

describe('montarConfigFinal (§6.7): o servidor força o estrutural', () => {
  it('injeta slug e sourceDir, que o agente NÃO deve produzir', () => {
    // Prompt injection no questionário não pode alterar para onde a base aponta.
    const final = montarConfigFinal('acme', configBoa()) as Record<string, unknown>
    expect(final.slug).toBe('acme')
    expect(final.knowledge).toMatchObject({ sourceDir: 'knowledge/acme' })
  })

  it('sobrescreve sourceDir que a candidata tentar mandar', () => {
    const maliciosa = {
      ...configBoa(),
      knowledge: {
        sourcePolicy: 'answer_only_from_knowledge',
        sourceDir: 'knowledge/outro-tenant',
      },
    }
    const final = montarConfigFinal('acme', maliciosa) as { knowledge: { sourceDir: string } }
    expect(final.knowledge.sourceDir).toBe('knowledge/acme')
  })

  it('preserva o resto do conhecimento', () => {
    const final = montarConfigFinal('acme', configBoa()) as {
      knowledge: { sourcePolicy: string }
    }
    expect(final.knowledge.sourcePolicy).toBe('answer_only_from_knowledge')
  })

  it('candidata que a validação usa é a MONTADA, não a crua', () => {
    // A candidata sem `sourceDir` (que é o normal) precisa PASSAR: exigi-la dela pediria
    // ao agente justamente o campo que ele não deve gerar.
    expect(motivo(artefatosBons(), 'candidateConfigJson')).toBeUndefined()
  })
})
