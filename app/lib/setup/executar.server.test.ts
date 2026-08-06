import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db.server'
import type { AttendantInput, AttendantOutput } from '../attendant/types'

// Integração de ponta a ponta do simulador sobre a candidata, SEM cérebro real: o provider
// mock é substituído por um duble controlável, e o validador continua o de verdade — é ele
// que precisa recusar a resposta mentirosa.
//
// O que se prova aqui: a config e a base que chegam ao motor são as da CANDIDATA, o tenant
// vem só da sessão, cada pré-condição barra ANTES do cérebro, e uma execução válida não
// deixa efeito operacional nenhum.

const cerebro = vi.hoisted(() => ({
  chamadas: 0,
  input: undefined as AttendantInput | undefined,
  saida: undefined as AttendantOutput | undefined,
}))

vi.mock('../attendant/providers/mock', () => ({
  mockProvider: {
    name: 'mock',
    generate: async (input: AttendantInput): Promise<AttendantOutput> => {
      cerebro.chamadas += 1
      cerebro.input = input
      if (!cerebro.saida) {
        throw new Error('teste não definiu a saída do cérebro')
      }
      return cerebro.saida
    },
  },
}))

// Alarme é saída para FORA (push no celular do operador). Um teste de preview tem que
// provar que nada disparou.
vi.mock('../alarm.server', () => ({
  reportDegradation: vi.fn(),
  reportSensitiveHandoff: vi.fn(),
}))

const { createOperatorSession } = await import('../auth.server')
const { reportDegradation, reportSensitiveHandoff } = await import('../alarm.server')
const { executarPreviewDaCandidata } = await import('./executar.server')
const { contactIdDoPreview } = await import('./preview')
const { buildPrompt } = await import('../attendant/providers/claude-cli.server')

/** Resposta que passa no validador: sem afirmar registro, sem ação. */
const RESPOSTA_BOA: AttendantOutput = {
  reply: 'Atendemos de 9h às 18h. Posso ajudar em algo mais?',
  needsHuman: false,
  handoffReason: null,
  leadPatch: null,
  confidence: 0.9,
  action: null,
}

const ARTEFATOS = {
  candidateConfigJson: JSON.stringify({
    businessProfile: { name: 'Clínica Bem Estar', segment: 'saúde', tone: 'cordial' },
    guardrails: { neverPromise: ['prazo de exame'] },
    escalationPolicy: {
      triggers: ['dor no peito'],
      defaultReason: 'tema_de_saude',
      humanMessage: 'Vou te encaminhar.',
    },
    objectives: ['tirar_duvidas'],
  }),
  candidateKnowledgeJson: JSON.stringify([
    { title: 'HORARIO DA CANDIDATA', content: 'Atendemos de 9h às 18h, de segunda a sexta.' },
  ]),
  summaryJson: JSON.stringify({ texto: 'Sua IA responde dúvidas de horário.' }),
  gapsJson: '[]',
  risksJson: '[]',
  validationJson: JSON.stringify(
    [1, 2, 3, 4, 5].map((i) => ({
      id: `q${i}`,
      question: `Pergunta ${i}?`,
      expectedFacts: ['um fato'],
      expectedBehavior: 'responder com o fato',
      shouldHandoff: false,
    })),
  ),
}

type Cenario = {
  slug: string
  tenantId: string
  setupId: string
  versionId: string
  accountId: string
}

/**
 * Cria empresa + setup + versão candidata + config e base PUBLICADAS bem diferentes.
 *
 * A base publicada existe de propósito em todo cenário: é o contra-fato. Se a execução ler
 * a publicada em vez da candidata, os testes acusam pelo conteúdo, não por sorte.
 */
async function criarCenario(estado = 'ready_to_test'): Promise<Cenario> {
  const slug = `exec-${crypto.randomUUID().slice(0, 8)}`
  const tenant = await db.tenant.create({ data: { slug, name: 'Empresa de Teste' } })
  const setup = await db.aiSetup.create({ data: { tenantId: tenant.id } })
  const versao = await db.aiSetupVersion.create({
    data: {
      setupId: setup.id,
      tenantId: tenant.id,
      state: estado,
      generation: 2,
      answersJson: '{}',
      ...ARTEFATOS,
    },
  })
  await db.aiSetup.update({ where: { id: setup.id }, data: { reviewVersionId: versao.id } })

  // PUBLICADA — o que está no ar hoje, com nome e base reconhecíveis.
  await db.tenantConfigRecord.create({
    data: {
      tenantId: tenant.id,
      json: JSON.stringify({
        businessProfile: {
          name: 'NOME PUBLICADO ANTIGO',
          segment: 'outro',
          tone: 'seco',
        },
        knowledge: { sourceDir: `knowledge/${slug}`, sourcePolicy: 'answer_only_from_knowledge' },
        guardrails: { neverPromise: [] },
        escalationPolicy: { triggers: [], defaultReason: 'x', humanMessage: 'y' },
        objectives: ['tirar_duvidas'],
        tools: [{ name: 'abrir_chamado', enabled: true }],
      }),
    },
  })
  await db.knowledgeDoc.create({
    data: { tenantId: tenant.id, title: 'DOC PUBLICADO ANTIGO', content: 'Conteúdo antigo.' },
  })

  return {
    slug,
    tenantId: tenant.id,
    setupId: setup.id,
    versionId: versao.id,
    accountId: `acc-${crypto.randomUUID().slice(0, 8)}`,
  }
}

/** Request com sessão REAL do cenário, e um `tenantSlug` hostil no corpo. */
async function pedidoAutenticado(c: Cenario, tenantNoCorpo?: string): Promise<Request> {
  const res = await createOperatorSession(
    {
      accountId: c.accountId,
      email: `dono@${c.slug}.local`,
      role: 'owner',
      tenantId: c.tenantId,
      tenantSlug: c.slug,
    },
    '/x',
  )
  const cookie = (res.headers.get('Set-Cookie') ?? '').split(';')[0]
  const body = new URLSearchParams({ message: 'oi' })
  if (tenantNoCorpo) {
    body.set('tenantSlug', tenantNoCorpo)
    body.set('tenantId', 'id-inventado')
  }
  return new Request('http://localhost/testar-ia', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
}

let cenario: Cenario

beforeEach(async () => {
  cerebro.chamadas = 0
  cerebro.input = undefined
  cerebro.saida = RESPOSTA_BOA
  cenario = await criarCenario()
})

afterEach(() => {
  vi.clearAllMocks()
})

/** Executa com a sessão do cenário e os valores corretos, salvo o que for sobrescrito. */
async function executar(
  c: Cenario,
  extra: Partial<Parameters<typeof executarPreviewDaCandidata>[0]> = {},
) {
  return executarPreviewDaCandidata({
    request: await pedidoAutenticado(c),
    setupVersionId: c.versionId,
    generation: 2,
    message: 'vocês atendem em que horário?',
    ...extra,
  })
}

describe('a candidata é o que chega ao motor', () => {
  it('1. a CONFIG que chega é a candidata, não a publicada', async () => {
    const r = await executar(cenario)

    expect(r.tipo).toBe('ok')
    // A persona no prompt vem de `businessProfile.name`: é o campo que separa as duas.
    expect(cerebro.input?.tenant.name).toBe('Clínica Bem Estar')
    expect(cerebro.input?.companyRules.join('\n')).toContain('Clínica Bem Estar')
    expect(cerebro.input?.companyRules.join('\n')).not.toContain('NOME PUBLICADO ANTIGO')
  })

  it('2. a BASE que chega ao retrieval é a candidata, não a publicada', async () => {
    await executar(cenario)

    const titulos = (cerebro.input?.knowledge ?? []).map((k) => k.title)
    expect(titulos).toContain('HORARIO DA CANDIDATA')
    expect(titulos).not.toContain('DOC PUBLICADO ANTIGO')
  })

  it('3. config e base vêm do MESMO snapshot', async () => {
    // Não basta cada uma estar certa: elas têm que ser do mesmo material. A prova é o par —
    // persona da candidata E base da candidata na mesma chamada ao cérebro.
    await executar(cenario)

    expect(cerebro.chamadas).toBe(1)
    expect(cerebro.input?.tenant.name).toBe('Clínica Bem Estar')
    expect((cerebro.input?.knowledge ?? []).map((k) => k.title)).toEqual(['HORARIO DA CANDIDATA'])
  })

  it('a conversa é isolada por versão e geração (§10.3)', async () => {
    const r = await executar(cenario)
    if (r.tipo !== 'ok') throw new Error(`esperava ok, veio ${r.codigo}`)

    const conversa = await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId } })
    expect(conversa.contactId).toBe(contactIdDoPreview(cenario.accountId, cenario.versionId, 2))
    expect(conversa.channel).toBe('simulator')
    expect(conversa.tenantId).toBe(cenario.tenantId)
  })
})

describe('autoridade: o tenant é só da sessão', () => {
  it('4. tenantSlug injetado no corpo não muda o tenant da sessão', async () => {
    const vitima = await criarCenario()

    // Sessão do atacante + slug da vítima no corpo + versão da vítima nos parâmetros.
    const r = await executarPreviewDaCandidata({
      request: await pedidoAutenticado(cenario, vitima.slug),
      setupVersionId: vitima.versionId,
      generation: 2,
      message: 'oi',
    })

    expect(r).toEqual({
      tipo: 'recusado',
      codigo: 'versao_desconhecida',
      orientacao: expect.any(String),
    })
    expect(cerebro.chamadas).toBe(0)
  })

  it('com o corpo hostil, a execução da PRÓPRIA versão continua funcionando', async () => {
    // O par simétrico: o corpo é ignorado, não é um gatilho de recusa.
    const outra = await criarCenario()
    const r = await executarPreviewDaCandidata({
      request: await pedidoAutenticado(cenario, outra.slug),
      setupVersionId: cenario.versionId,
      generation: 2,
      message: 'oi',
    })

    expect(r.tipo).toBe('ok')
  })
})

describe('nenhuma pré-condição chega ao cérebro', () => {
  it('5. geração divergente não chama o motor', async () => {
    const r = await executar(cenario, { generation: 1 })

    expect(r.tipo).toBe('recusado')
    if (r.tipo !== 'recusado') return
    expect(r.codigo).toBe('geracao_divergente')
    expect(cerebro.chamadas).toBe(0)
  })

  it.each([
    'draft',
    'submitted',
    'needs_changes',
    'customer_approved',
    'active',
  ])('6. estado "%s" não chama o motor', async (estado) => {
    const outro = await criarCenario(estado)

    const r = await executar(outro)

    expect(r.tipo).toBe('recusado')
    if (r.tipo !== 'recusado') return
    expect(r.codigo).toBe('nao_e_candidata')
    expect(cerebro.chamadas).toBe(0)
  })

  it('7. base mudada não chama o motor', async () => {
    const publicada = await db.aiSetupVersion.create({
      data: {
        setupId: cenario.setupId,
        tenantId: cenario.tenantId,
        state: 'active',
        generation: 1,
        answersJson: '{}',
        publishedAt: new Date(),
      },
    })
    await db.aiSetup.update({
      where: { id: cenario.setupId },
      data: { publishedVersionId: publicada.id },
    })

    const r = await executar(cenario)

    expect(r.tipo).toBe('recusado')
    if (r.tipo !== 'recusado') return
    expect(r.codigo).toBe('base_mudou')
    expect(cerebro.chamadas).toBe(0)
  })

  it('8. artefatos inválidos não chamam o motor', async () => {
    await db.aiSetupVersion.update({
      where: { id: cenario.versionId },
      data: { candidateKnowledgeJson: '[]' },
    })

    const r = await executar(cenario)

    expect(r.tipo).toBe('recusado')
    if (r.tipo !== 'recusado') return
    expect(r.codigo).toBe('artefatos_invalidos')
    expect(cerebro.chamadas).toBe(0)
  })

  it('9. ponteiro incoerente não chama o motor e a orientação é genérica', async () => {
    // Os DOIS motivos internos, e uma orientação só. Contar a diferença descreveria a
    // estrutura do banco para quem não pode agir sobre ela.
    await db.aiSetup.update({
      where: { id: cenario.setupId },
      data: { reviewVersionId: null },
    })
    const naoPendente = await executar(cenario)

    const outra = await criarCenario()
    const intrusa = await db.aiSetupVersion.create({
      data: {
        setupId: outra.setupId, // setup de outra empresa
        tenantId: cenario.tenantId, // tenant meu
        state: 'ready_to_test',
        generation: 2,
        answersJson: '{}',
        ...ARTEFATOS,
      },
    })
    const setupAlheio = await executar(cenario, { setupVersionId: intrusa.id })

    expect(naoPendente.tipo).toBe('recusado')
    expect(setupAlheio).toEqual(naoPendente)
    if (naoPendente.tipo !== 'recusado') return
    expect(naoPendente.codigo).toBe('ponteiro_incoerente')
    // Sem termo interno na orientação.
    for (const proibido of ['ponteiro', 'setup', 'tenant', 'versionId']) {
      expect(naoPendente.orientacao.toLowerCase()).not.toContain(proibido)
    }
    expect(cerebro.chamadas).toBe(0)
  })
})

describe('nenhum efeito operacional', () => {
  it('10. execução válida não cria lead, chamado, handoff nem alarme', async () => {
    // A saída do cérebro é escolhida para DISPARAR tudo se os efeitos estivessem ligados:
    // escala para humano e sugere dados de lead. A mensagem traz telefone, que aciona
    // também o lead determinístico, anterior ao cérebro.
    cerebro.saida = {
      reply: 'Vou te encaminhar para uma pessoa do time.',
      needsHuman: true,
      handoffReason: 'caso_complexo',
      leadPatch: { name: 'Maria', phone: '11999998888' },
      confidence: 0.5,
      action: {
        type: 'abrir_chamado',
        subject: 'agendar consulta',
        description: 'cliente quer agendar',
      },
    }

    const r = await executar(cenario, { message: 'meu telefone é 11999998888, me ajuda' })
    if (r.tipo !== 'ok') throw new Error(`esperava ok, veio ${r.codigo}`)

    expect(await db.lead.count({ where: { tenantId: cenario.tenantId } })).toBe(0)
    // Hoje o chamado é barrado DUAS vezes (a política do servidor deixa `tools: []`, e o
    // preview não executa efeitos). A asserção fica para quando a política habilitar a
    // primeira ferramenta e sobrar só a segunda barreira.
    expect(await db.ticket.count({ where: { tenantId: cenario.tenantId } })).toBe(0)
    expect(await db.handoffEvent.count({ where: { conversationId: r.conversationId } })).toBe(0)
    expect(reportSensitiveHandoff).not.toHaveBeenCalled()
    expect(reportDegradation).not.toHaveBeenCalled()

    // E o status operacional da conversa não muda, mesmo com needsHuman.
    const conversa = await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId } })
    expect(conversa.status).toBe('open')
    // O retorno diz que precisa de humano — quem lê a tela sabe; o balcão é que não age.
    expect(r.needsHuman).toBe(true)
  })

  it('a versão e a geração que responderam voltam no resultado', async () => {
    const r = await executar(cenario)
    if (r.tipo !== 'ok') throw new Error(`esperava ok, veio ${r.codigo}`)

    expect(r.versionId).toBe(cenario.versionId)
    expect(r.generation).toBe(2)
  })
})

describe('o snapshot sozinho já desliga os efeitos', () => {
  it('previewSnapshot SEM preview:true também não cria efeito operacional', async () => {
    // O executor passa `preview: true`, então esta garantia não apareceria por ele. Ela existe
    // para o próximo chamador: uma config candidata não pode criar lead e chamado de verdade
    // por alguém ter esquecido a flag. O motor deriva o modo do snapshot.
    const { processIncomingMessage } = await import('../conversation.server')
    const { resolverFonteDoPreview } = await import('./preview.server')

    const fonte = await resolverFonteDoPreview({
      tenantSlug: cenario.slug,
      setupVersionId: cenario.versionId,
      generation: 2,
    })
    if (fonte.tipo !== 'ok') throw new Error(`esperava ok, veio ${fonte.tipo}`)

    cerebro.saida = {
      reply: 'Vou te encaminhar.',
      needsHuman: true,
      handoffReason: 'caso_complexo',
      leadPatch: { name: 'Maria', phone: '11999998888' },
      confidence: 0.5,
      action: null,
    }

    const r = await processIncomingMessage({
      tenantSlug: cenario.slug,
      message: 'meu telefone é 11999998888',
      contactId: contactIdDoPreview(cenario.accountId, cenario.versionId, 2),
      channel: 'simulator',
      // preview: true  ← DE PROPÓSITO ausente
      previewSnapshot: { config: fonte.fonte.config, conhecimento: fonte.fonte.conhecimento },
    })

    expect(await db.lead.count({ where: { tenantId: cenario.tenantId } })).toBe(0)
    expect(await db.handoffEvent.count({ where: { conversationId: r.conversationId } })).toBe(0)
    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId } })).status,
    ).toBe('open')
  })
})

describe('a candidata sem ferramenta não pode prometer', () => {
  it('11. o prompt do snapshot mantém o schema com "action": null', async () => {
    // A política do servidor deixa `tools: []`, então o motor manda `enabledTools: []` — e o
    // prompt construído a partir dele não anuncia sequer o objeto da action.
    await executar(cenario)
    const input = cerebro.input
    if (!input) throw new Error('o cérebro não foi chamado')

    expect(input.enabledTools).toEqual([])

    const prompt = buildPrompt(input)
    expect(prompt).toContain('"action": null')
    expect(prompt).not.toContain('abrir_chamado')
  })

  it('12. resposta que afirma registro sem action cai no fallback honesto', async () => {
    cerebro.saida = {
      reply: 'Pronto! Já registrei seu chamado. Nossa equipe entra em contato.',
      needsHuman: false,
      handoffReason: null,
      leadPatch: null,
      confidence: 0.9,
      action: null,
    }

    const r = await executar(cenario)
    if (r.tipo !== 'ok') throw new Error(`esperava ok, veio ${r.codigo}`)

    // O validador recusou e o motor devolveu o fallback: nada de "já registrei" na tela.
    expect(r.reply).not.toContain('registrei')
    expect(r.needsHuman).toBe(true)
    // Fallback em preview não alarma: o alarme diz "o cliente recebeu a resposta genérica",
    // e aqui não havia cliente.
    expect(reportDegradation).not.toHaveBeenCalled()
  })
})
