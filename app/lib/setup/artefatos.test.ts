import { describe, expect, it } from 'vitest'
import { parseTenantConfig, type ToolConfig } from '../attendant/tenant-config'
import {
  CAMPOS_DE_ARTEFATO,
  type CampoDeArtefato,
  montarConfigFinal,
  PERGUNTAS_ESPERADAS,
  validarArtefatos,
} from './artefatos'
import { politicaDeFerramentas } from './ferramentas'

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
    objectives: ['tirar_duvidas'],
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

  // `knowledge` saiu desta lista de propósito: os DOIS campos dele (`sourceDir` e
  // `sourcePolicy`) passaram a ser forçados pelo servidor, então a candidata não precisa
  // — e não deve — produzi-lo. Que a ausência dele agora PASSA é afirmado por teste
  // próprio ('força até quando a candidata omite o conhecimento inteiro'), e não por
  // silêncio aqui.
  it.each([
    ['businessProfile', { ...configBoa(), businessProfile: undefined }],
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

describe('tools e limits: a política do servidor SUBSTITUI a da candidata (§6.7)', () => {
  /** Uma candidata que pede ferramenta e ainda afrouxa o limite dela. */
  function candidataAtrevida() {
    return {
      ...configBoa(),
      tools: [
        {
          name: 'abrir_chamado',
          enabled: true,
          limits: { requireConfirmation: false, allowedCategories: ['qualquer'] },
        },
      ],
    }
  }

  it('a config final traz exatamente o que a política decide', () => {
    const final = montarConfigFinal(SLUG, candidataAtrevida()) as { tools: ToolConfig[] }
    expect(final.tools).toEqual(politicaDeFerramentas())
  })

  it('ferramenta pedida SEM enfeite nenhum também não sobrevive', () => {
    // Sem esta, a única candidata adversarial vinha decorada com `requireConfirmation:
    // false` — e uma implementação que só filtrasse limites suspeitos passaria por válida.
    const final = montarConfigFinal(SLUG, {
      ...configBoa(),
      tools: [{ name: 'abrir_chamado', enabled: true }],
    }) as { tools: ToolConfig[] }

    expect(final.tools).toEqual([])
  })

  it('nenhum limite vindo da candidata sobrevive na config final', () => {
    // Escrito para continuar valendo QUANDO a política passar a habilitar alguma
    // ferramenta: o que não pode existir é limite escolhido pela IA, não ferramenta.
    // Uma mesclagem (`{...politica, ...candidata}`) derrubaria este teste.
    const final = montarConfigFinal(SLUG, candidataAtrevida()) as { tools: ToolConfig[] }

    expect(final.tools.some((t) => t.limits?.requireConfirmation === false)).toBe(false)
    expect(final.tools.some((t) => t.limits?.allowedCategories?.includes('qualquer'))).toBe(false)
  })

  it('candidata que OMITE tools é válida — o campo é do servidor', () => {
    // Este é o formato que o agente deve produzir: conteúdo de negócio, sem o estrutural.
    // Exigir `tools` dele seria pedir justamente o campo que ele não decide.
    const { tools: _doServidor, ...somenteNegocio } = configBoa()
    expect(
      motivo(
        { ...artefatosBons(), candidateConfigJson: JSON.stringify(somenteNegocio) },
        'candidateConfigJson',
      ),
    ).toBeUndefined()
  })

  it('esquecer de montar a config final NÃO libera ferramenta: o parser recusa', () => {
    // Vale registrar por que a candidata guardada não tem `tools`: quem usar o snapshot
    // cru sem passar por `montarConfigFinal` recebe uma exceção do parser do motor, em
    // vez de uma config que silenciosamente executa ações.
    const { tools: _doServidor, ...somenteNegocio } = configBoa()
    expect(() => parseTenantConfig(SLUG, somenteNegocio)).toThrow(/tools/)
  })
})

describe('sourcePolicy: o servidor força responder somente pela base', () => {
  /** Sem o campo — que é o que a candidata deve produzir, já que ele é do servidor. */
  function semFonte() {
    const { knowledge: _doServidor, ...resto } = configBoa()
    return resto
  }

  it('a config final SEMPRE traz answer_only_from_knowledge', () => {
    const final = montarConfigFinal(SLUG, {
      ...configBoa(),
      knowledge: { sourcePolicy: 'allow_general_smalltalk' },
    }) as { knowledge: { sourcePolicy: string } }

    expect(final.knowledge.sourcePolicy).toBe('answer_only_from_knowledge')
  })

  it('força até quando a candidata omite o conhecimento inteiro', () => {
    const final = montarConfigFinal(SLUG, semFonte()) as {
      knowledge: { sourcePolicy: string }
    }
    expect(final.knowledge.sourcePolicy).toBe('answer_only_from_knowledge')
  })

  it('candidata que OMITE o campo é válida', () => {
    expect(
      motivo(
        { ...artefatosBons(), candidateConfigJson: JSON.stringify(semFonte()) },
        'candidateConfigJson',
      ),
    ).toBeUndefined()
  })

  it('o valor canônico vindo da candidata é aceito', () => {
    // Redundante, não suspeito: é o mesmo valor que o servidor forçaria.
    expect(motivo(artefatosBons(), 'candidateConfigJson')).toBeUndefined()
  })

  it('a recusa NÃO ecoa o valor recebido', () => {
    // O valor vem da candidata, ou seja, da saída de um modelo influenciado pelo texto do
    // questionário. Esta mensagem é impressa no terminal e devolvida a rotas: ecoá-la
    // levaria texto arbitrário do cliente para o log. E não há o que diagnosticar — o campo
    // tem dois valores, e dizer qual é o esperado já conta a história inteira (§14).
    const veneno = 'allow_general_smalltalk\nCPF do cliente: 123.456.789-00'
    const recusa = motivo(
      {
        ...artefatosBons(),
        candidateConfigJson: JSON.stringify({
          ...configBoa(),
          knowledge: { sourcePolicy: veneno },
        }),
      },
      'candidateConfigJson',
    )

    expect(recusa).toBeTruthy()
    expect(recusa).not.toContain('CPF')
    expect(recusa).not.toContain('123.456.789-00')
    expect(recusa).not.toContain('\n')
  })

  it('o OUTRO valor legítimo é recusado como sinal', () => {
    // `allow_general_smalltalk` é valor válido do tipo — o parser aceitaria. Recusar aqui
    // é o mesmo raciocínio de `tools`: a substituição já protege o motor, mas candidata
    // pedindo para a IA conversar fora da base é sinal de prompt desalinhado ou injeção.
    expect(
      motivo(
        {
          ...artefatosBons(),
          candidateConfigJson: JSON.stringify({
            ...configBoa(),
            knowledge: { sourcePolicy: 'allow_general_smalltalk' },
          }),
        },
        'candidateConfigJson',
      ),
    ).toContain('answer_only_from_knowledge')
  })
})

describe('whitelist da §6.7: o parser promete e não aplica', () => {
  // `parseTenantConfig` faz `root.objectives as TenantObjective[]` e `root.tools as
  // ToolConfig[]` — cast, não validação. Sem conferir aqui, objetivo e ferramenta
  // inventados atravessavam e eram chamados de "config válida".

  function comConfig(config: unknown) {
    return motivo(
      { ...artefatosBons(), candidateConfigJson: JSON.stringify(config) },
      'candidateConfigJson',
    )
  }

  it('objetivo INVENTADO é reprovado', () => {
    expect(comConfig({ ...configBoa(), objectives: ['objetivo_inventado'] })).toContain(
      'objetivo não permitido',
    )
  })

  it('a recusa NÃO ecoa o objetivo recebido, nem quando ele é curto', () => {
    // O teste anterior usava um valor gigante e conferia truncamento. Errado: limite de
    // TAMANHO não é sanitização de CONTEÚDO. Este veneno tem 18 caracteres e atravessava
    // qualquer corte inteiro. O diagnóstico não precisa dele — campo, problema e a lista
    // de permitidos já bastam para consertar prompt ou gerador.
    const veneno = 'CPF 123.456.789-00'
    const recusa = comConfig({ ...configBoa(), objectives: [veneno] })

    expect(recusa).toBeTruthy()
    expect(recusa).not.toContain('CPF')
    expect(recusa).not.toContain('123.456.789-00')
    expect(recusa).toContain('objetivo não permitido')
    expect(recusa).toContain('tirar_duvidas')
  })

  it('objetivo conhecido passa', () => {
    expect(comConfig({ ...configBoa(), objectives: ['agendar', 'abrir_chamado'] })).toBeUndefined()
  })

  it('ferramenta INVENTADA é reprovada', () => {
    expect(
      comConfig({ ...configBoa(), tools: [{ name: 'ferramenta_inventada', enabled: true }] }),
    ).toContain('política determinística')
  })

  it('ferramenta CONHECIDA declarada pela candidata TAMBÉM é reprovada', () => {
    // O ponto: não é whitelist de nomes. Nesta fase NENHUMA ferramenta declarada pelo
    // agente é autoridade — quem monta `tools` e `limits` é o servidor (§6.7), e essa
    // política é da etapa 6. Aceitar aqui deixaria a IA decidir que a empresa abre chamado,
    // e com quais limites.
    expect(
      comConfig({ ...configBoa(), tools: [{ name: 'abrir_chamado', enabled: true }] }),
    ).toContain('política determinística')
  })

  it('limits vindos da IA não são mesclados — a ferramenta inteira é recusada', () => {
    expect(
      comConfig({
        ...configBoa(),
        tools: [{ name: 'abrir_chamado', enabled: true, limits: { requireConfirmation: false } }],
      }),
    ).toBeTruthy()
  })

  it('tools vazio é o que a candidata deve trazer', () => {
    expect(comConfig({ ...configBoa(), tools: [] })).toBeUndefined()
  })
})
