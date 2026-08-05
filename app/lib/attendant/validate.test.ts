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

  // Negação: dizer que NÃO faz é a resposta certa, não uma promessa. O caso real é
  // o csmed com 'diagnostico' em neverPromise — a base ENSINA a dizer "não fazemos
  // diagnóstico pelo WhatsApp" e o validador derrubava a resposta certa pro fallback.
  it('aceita a frase proibida quando NEGADA (ex.: "não fazemos diagnóstico")', () => {
    const policy = { extraForbiddenClaims: ['diagnostico'] }
    expect(
      validateAttendantOutput(
        { ...good, reply: 'Não fazemos diagnóstico pelo WhatsApp — a avaliação é presencial.' },
        policy,
      ).ok,
    ).toBe(true)
    expect(
      validateAttendantOutput({ ...good, reply: 'Nunca damos diagnóstico por aqui, tá?' }, policy)
        .ok,
    ).toBe(true)
  })

  it('continua rejeitando a frase proibida afirmativa', () => {
    const policy = { extraForbiddenClaims: ['diagnostico'] }
    expect(
      validateAttendantOutput({ ...good, reply: 'O diagnóstico é bronquite leve.' }, policy).ok,
    ).toBe(false)
    expect(
      validateAttendantOutput({ ...good, reply: 'Posso te passar o diagnóstico agora.' }, policy)
        .ok,
    ).toBe(false)
  })

  it('não deixa a negação de uma frase salvar OUTRA ocorrência afirmativa', () => {
    const policy = { extraForbiddenClaims: ['diagnostico'] }
    expect(
      validateAttendantOutput(
        { ...good, reply: 'Não cobramos consulta, mas o diagnóstico é gripe.' },
        policy,
      ).ok,
    ).toBe(false)
  })

  it('negação em sentença ANTERIOR não salva a afirmativa seguinte', () => {
    expect(
      validateAttendantOutput({
        ...good,
        reply: 'Não posso agendar hoje. O conserto garantido sai amanhã.',
      }).ok,
    ).toBe(false)
  })

  // Achado da revisão adversarial: vírgula e conjunção quebram o escopo da negação
  // — "Não fazemos X, e o diagnóstico é Y" NÃO está negado.
  it('vírgula/conjunção quebram o escopo da negação (afirmativa depois é barrada)', () => {
    const policy = { extraForbiddenClaims: ['diagnostico'] }
    expect(
      validateAttendantOutput(
        { ...good, reply: 'Não fazemos cirurgia, e o diagnóstico é gripe.' },
        policy,
      ).ok,
    ).toBe(false)
    expect(
      validateAttendantOutput(
        { ...good, reply: 'Não cobramos nada: o diagnóstico é bronquite.' },
        policy,
      ).ok,
    ).toBe(false)
  })

  // Visto ao vivo na prova de 2026-07-03: "Já registrei sua solicitação" com
  // action null — o cliente acharia que está registrado e não está.
  it('rejeita reply que AFIRMA registro sem propor a action (tenant com a tool)', () => {
    const policy = { tools: [{ name: 'abrir_chamado' }] }
    expect(
      validateAttendantOutput(
        { ...good, reply: 'Perfeito! Já registrei sua solicitação, o time retorna em breve.' },
        policy,
      ),
    ).toEqual({ ok: false, reason: 'reply_afirma_registro_sem_action' })
    expect(validateAttendantOutput({ ...good, reply: 'Pronto, chamado aberto!' }, policy).ok).toBe(
      false,
    )
  })

  it('aceita "registrei" quando a action abrir_chamado VEM junto', () => {
    const policy = { tools: [{ name: 'abrir_chamado' }] }
    const result = validateAttendantOutput(
      {
        ...good,
        reply: 'Registrei sua solicitação! O time retorna em breve.',
        action: { type: 'abrir_chamado', subject: 'plantão fim de semana', description: 'd' },
      },
      policy,
    )
    expect(result.ok).toBe(true)
  })

  it('formas em aberto ("posso registrar?", "vou registrar") não são barradas', () => {
    const policy = { tools: [{ name: 'abrir_chamado' }] }
    expect(
      validateAttendantOutput(
        { ...good, reply: 'Quer que eu registre? Posso registrar agora.' },
        policy,
      ).ok,
    ).toBe(true)
  })

  // O guard vale SEMPRE, inclusive (e principalmente) para o tenant SEM a tool:
  // aí nada pode ser registrado, então qualquer "já registrei" é mentira certa.
  // Antes, o guard era condicionado a ter a tool e estes casos passavam — o cliente
  // ouvia "registrei seu chamado" com nada no banco (tenants novos nascem `tools: []`).
  it('recusa reply que AFIRMA registro no tenant SEM a tool (nada pode ser registrado)', () => {
    const semTool = { tools: [] }
    expect(
      validateAttendantOutput(
        { ...good, reply: 'Pronto! Já registrei seu chamado. Nossa equipe entra em contato.' },
        semTool,
      ),
    ).toEqual({ ok: false, reason: 'reply_afirma_registro_sem_action' })
    // Mesmo COM action proposta: sem a tool ela é descartada, a frase segue mentira.
    expect(
      validateAttendantOutput(
        {
          ...good,
          reply: 'Pronto! Já registrei seu chamado.',
          action: { type: 'abrir_chamado', subject: 'geladeira', description: 'não gela' },
        },
        semTool,
      ).ok,
    ).toBe(false)
  })

  it('recusa reply que afirma registro sem action mesmo sem policy alguma', () => {
    expect(validateAttendantOutput({ ...good, reply: 'Pronto, chamado aberto!' }).ok).toBe(false)
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

  it('descarta action que agenda item FORA do escopo (no subject) sem invalidar a resposta', () => {
    const action = {
      type: 'abrir_chamado',
      subject: 'Visita técnica - micro-ondas',
      description: 'não esquenta',
    }
    const result = validateAttendantOutput({ ...good, action }, { outOfScope: ['micro-ondas'] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.action).toBeNull()
    }
  })

  it('descarta action com item fora do escopo citado na description', () => {
    const action = {
      type: 'abrir_chamado',
      subject: 'conserto',
      description: 'o forno elétrico parou',
    }
    const result = validateAttendantOutput({ ...good, action }, { outOfScope: ['forno'] })
    expect(result.ok && result.value.action).toBeNull()
  })

  it('mantém action DENTRO do escopo mesmo com outOfScope configurado', () => {
    const action = { type: 'abrir_chamado', subject: 'Visita - geladeira', description: 'não gela' }
    const result = validateAttendantOutput(
      { ...good, action },
      { outOfScope: ['micro-ondas', 'forno'] },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.action?.type).toBe('abrir_chamado')
    }
  })

  it('casa fora-do-escopo sem acento/caixa (fogão → FOGÃO)', () => {
    const action = { type: 'abrir_chamado', subject: 'Conserto de FOGÃO', description: 'd' }
    const result = validateAttendantOutput({ ...good, action }, { outOfScope: ['fogao'] })
    expect(result.ok && result.value.action).toBeNull()
  })

  it('casa variantes de grafia (micro-ondas ⇄ microondas ⇄ micro ondas)', () => {
    const policy = { outOfScope: ['micro-ondas'] }
    for (const subject of ['Visita - microondas', 'conserto de micro ondas', 'MICRO-ONDAS parou']) {
      const result = validateAttendantOutput(
        { ...good, action: { type: 'abrir_chamado', subject, description: 'd' } },
        policy,
      )
      expect(result.ok && result.value.action).toBeNull()
    }
  })

  it('termo vazio/espaço em outOfScope não derruba uma action válida', () => {
    const action = { type: 'abrir_chamado', subject: 'Visita - geladeira', description: 'd' }
    const result = validateAttendantOutput({ ...good, action }, { outOfScope: ['', '   '] })
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

  // Categoria fora da lista derruba SÓ a categoria — descartar a action inteira
  // por um rótulo inválido matou um chamado real na prova de 2026-07-03.
  it('categoria fora de allowedCategories vira null, mas a action SOBREVIVE', () => {
    const action = { type: 'abrir_chamado', subject: 's', description: 'd', category: 'xpto' }
    const policy = {
      tools: [{ name: 'abrir_chamado', limits: { allowedCategories: ['documento', 'guia'] } }],
    }
    const result = validateAttendantOutput({ ...good, action }, policy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.action?.type).toBe('abrir_chamado')
      expect(result.value.action?.category).toBeUndefined()
    }
  })

  it('mas se o tenant EXIGE categoria (requiredFields), a inválida ainda barra a action', () => {
    const action = { type: 'abrir_chamado', subject: 's', description: 'd', category: 'xpto' }
    const policy = {
      tools: [
        {
          name: 'abrir_chamado',
          limits: { allowedCategories: ['documento'], requiredFields: ['category'] },
        },
      ],
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
