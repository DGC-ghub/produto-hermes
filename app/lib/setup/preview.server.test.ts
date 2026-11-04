import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db.server'
import { resolverFonteDoPreview } from './preview.server'

// Integração com o banco de teste. O que se prova aqui é ISOLAMENTO e PRÉ-CONDIÇÃO: que uma
// versão de outra empresa não é resolvida, e que estado/geração/ponteiro/artefatos barram
// antes de qualquer material chegar ao simulador. A conversão pura está em preview.test.ts.

let slug: string
let tenantId: string
let setupId: string
let versionId: string

/** Artefatos que o produto CONSEGUE usar — atravessam o parser do motor. */
const ARTEFATOS = {
  candidateConfigJson: JSON.stringify({
    businessProfile: { name: 'Clínica Bem Estar', segment: 'saúde', tone: 'cordial' },
    guardrails: { neverPromise: ['prazo de exame'] },
    escalationPolicy: {
      triggers: ['dor'],
      defaultReason: 'tema_de_saude',
      humanMessage: 'Vou te encaminhar.',
    },
    objectives: ['tirar_duvidas'],
  }),
  candidateKnowledgeJson: JSON.stringify([{ title: 'FAQ', content: 'Atendemos 9h às 18h.' }]),
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

/** Cria um tenant com setup, versão e ponteiro de revisão. Devolve os ids. */
async function criarTenant(estado: string, dados: Record<string, unknown> = {}) {
  const s = `prev-${crypto.randomUUID().slice(0, 8)}`
  const tenant = await db.tenant.create({ data: { slug: s, name: 'Tenant de teste' } })
  const setup = await db.aiSetup.create({ data: { tenantId: tenant.id } })
  const versao = await db.aiSetupVersion.create({
    data: {
      setupId: setup.id,
      tenantId: tenant.id,
      state: estado,
      generation: 2,
      answersJson: '{}',
      ...ARTEFATOS,
      ...dados,
    },
  })
  await db.aiSetup.update({ where: { id: setup.id }, data: { reviewVersionId: versao.id } })
  return { slug: s, tenantId: tenant.id, setupId: setup.id, versionId: versao.id }
}

beforeEach(async () => {
  const criado = await criarTenant('ready_to_test')
  slug = criado.slug
  tenantId = criado.tenantId
  setupId = criado.setupId
  versionId = criado.versionId
})

/** O pedido do caminho feliz. */
function pedido(extra: Record<string, unknown> = {}) {
  return { tenantSlug: slug, setupVersionId: versionId, generation: 2, ...extra }
}

describe('caminho feliz', () => {
  it('resolve config E conhecimento da candidata', async () => {
    const r = await resolverFonteDoPreview(pedido())

    expect(r.tipo).toBe('ok')
    if (r.tipo !== 'ok') return
    expect(r.fonte.versionId).toBe(versionId)
    expect(r.fonte.generation).toBe(2)
    expect(r.fonte.config.businessProfile.name).toBe('Clínica Bem Estar')
    expect(r.fonte.conhecimento.map((d) => d.title)).toEqual(['FAQ'])
  })

  it('a config vem MONTADA pelo servidor, não crua', async () => {
    // Os campos que a candidata não produz: slug, sourceDir, sourcePolicy e tools. Se
    // viessem da candidata, o teste passaria com a config crua — e o slug não estaria ali.
    const r = await resolverFonteDoPreview(pedido())
    if (r.tipo !== 'ok') throw new Error(`esperava ok, veio ${r.tipo}`)

    expect(r.fonte.config.slug).toBe(slug)
    expect(r.fonte.config.knowledge.sourceDir).toBe(`knowledge/${slug}`)
    expect(r.fonte.config.knowledge.sourcePolicy).toBe('answer_only_from_knowledge')
    expect(r.fonte.config.tools).toEqual([])
  })

  it('o conhecimento vem da CANDIDATA, não da base publicada', async () => {
    // A prova: um doc publicado no banco com outro título. Se a resolução lesse a base do
    // tenant, ele apareceria — e o dono aprovaria uma IA testada sobre o material errado.
    await db.knowledgeDoc.create({
      data: { tenantId, title: 'DOC PUBLICADO ANTIGO', content: 'conteúdo velho' },
    })

    const r = await resolverFonteDoPreview(pedido())
    if (r.tipo !== 'ok') throw new Error(`esperava ok, veio ${r.tipo}`)

    expect(r.fonte.conhecimento.map((d) => d.title)).toEqual(['FAQ'])
    expect(r.fonte.conhecimento.map((d) => d.title)).not.toContain('DOC PUBLICADO ANTIGO')
  })
})

describe('isolamento entre empresas', () => {
  it('versão de OUTRA empresa não é resolvida', async () => {
    const outra = await criarTenant('ready_to_test')

    const r = await resolverFonteDoPreview(pedido({ setupVersionId: outra.versionId }))

    expect(r).toEqual({ tipo: 'versao_desconhecida' })
  })

  it('a recusa é INDISTINGUÍVEL de id inexistente', async () => {
    // Responder "existe, mas não é sua" confirmaria a existência de um id alheio. As duas
    // respostas têm que ser byte a byte iguais.
    const outra = await criarTenant('ready_to_test')

    const deOutra = await resolverFonteDoPreview(pedido({ setupVersionId: outra.versionId }))
    const inexistente = await resolverFonteDoPreview(pedido({ setupVersionId: 'nao-existe' }))

    expect(deOutra).toEqual(inexistente)
  })

  it('tenant desconhecido não resolve nada', async () => {
    expect(await resolverFonteDoPreview(pedido({ tenantSlug: 'nao-existe' }))).toEqual({
      tipo: 'tenant_desconhecido',
    })
  })
})

describe('pré-condições', () => {
  it.each([
    'draft',
    'submitted',
    'needs_changes',
    'customer_approved',
    'active',
    'superseded',
  ])('estado "%s" não é candidata testável', async (estado) => {
    const outro = await criarTenant(estado)

    const r = await resolverFonteDoPreview({
      tenantSlug: outro.slug,
      setupVersionId: outro.versionId,
      generation: 2,
    })

    expect(r).toEqual({ tipo: 'nao_e_candidata', estado })
  })

  it('versão que não é mais a pendente do setup é recusada', async () => {
    // Ponteiro movido: a linha diz `ready_to_test`, mas não é o que está em revisão.
    await db.aiSetup.update({ where: { id: setupId }, data: { reviewVersionId: null } })

    expect(await resolverFonteDoPreview(pedido())).toEqual({
      tipo: 'ponteiro_incoerente',
      motivo: 'nao_e_a_pendente',
    })
  })

  it('versão cujo SETUP é de outra empresa é recusada', async () => {
    // Linha incoerente: `tenantId` é meu (então passa o escopo do where), mas `setupId`
    // aponta para o setup de OUTRA empresa. Sem vincular o setup, a coerência de ponteiro
    // seria conferida contra o setup alheio — decidindo o meu teste pelos dados dele.
    const outra = await criarTenant('ready_to_test')
    const intrusa = await db.aiSetupVersion.create({
      data: {
        setupId: outra.setupId, // ← setup da outra empresa
        tenantId, // ← mas o tenant é o meu
        state: 'ready_to_test',
        generation: 2,
        answersJson: '{}',
        ...ARTEFATOS,
      },
    })

    const r = await resolverFonteDoPreview(pedido({ setupVersionId: intrusa.id }))

    expect(r).toEqual({ tipo: 'ponteiro_incoerente', motivo: 'setup_de_outro_tenant' })
  })

  it('candidata pensada sobre uma publicação ANTIGA é recusada (§4.8)', async () => {
    // Publicaram entre a preparação e agora: a candidata raciocinou sobre uma configuração
    // que já não é a vigente. Testar e aprovar isso desfaria uma correção que está no ar.
    // O claim de revisão já barra este caso (`base_mudou`); o simulador precisa barrar
    // também, senão o dono aprova pelo caminho que não confere.
    const publicada = await db.aiSetupVersion.create({
      data: {
        setupId,
        tenantId,
        state: 'active',
        generation: 1,
        answersJson: '{}',
        publishedAt: new Date(),
      },
    })
    await db.aiSetup.update({
      where: { id: setupId },
      data: { publishedVersionId: publicada.id },
    })

    expect(await resolverFonteDoPreview(pedido())).toEqual({ tipo: 'base_mudou' })
  })

  it('base ainda vigente NÃO é recusada', async () => {
    // O par simétrico: a candidata que aponta para a publicação atual passa. Sem ele, um
    // guarda que recusasse sempre também ficaria verde.
    const publicada = await db.aiSetupVersion.create({
      data: {
        setupId,
        tenantId,
        state: 'active',
        generation: 1,
        answersJson: '{}',
        publishedAt: new Date(),
      },
    })
    await db.aiSetup.update({ where: { id: setupId }, data: { publishedVersionId: publicada.id } })
    await db.aiSetupVersion.update({
      where: { id: versionId },
      data: { basePublishedVersionId: publicada.id },
    })

    expect((await resolverFonteDoPreview(pedido())).tipo).toBe('ok')
  })

  it('geração diferente da que o cliente pensa é recusada, dizendo a atual', async () => {
    // A aba aberta antes do ciclo de correção. Sem isto, marcaria validação na geração errada.
    expect(await resolverFonteDoPreview(pedido({ generation: 1 }))).toEqual({
      tipo: 'geracao_divergente',
      atual: 2,
    })
  })

  it('artefatos inválidos são recusados ANTES de montar qualquer coisa', async () => {
    // Base de conhecimento vazia: o motor não teria de onde responder, e testar isso
    // ensinaria ao dono que a IA dele é ruim quando o defeito é do material.
    await db.aiSetupVersion.update({
      where: { id: versionId },
      data: { candidateKnowledgeJson: '[]' },
    })

    const r = await resolverFonteDoPreview(pedido())

    expect(r.tipo).toBe('artefatos_invalidos')
    if (r.tipo !== 'artefatos_invalidos') return
    expect(r.problemas.map((p) => p.campo)).toContain('candidateKnowledgeJson')
  })

  it('config que o motor não carregaria é recusada, não montada às cegas', async () => {
    await db.aiSetupVersion.update({
      where: { id: versionId },
      data: { candidateConfigJson: '{"businessProfile":{}}' },
    })

    const r = await resolverFonteDoPreview(pedido())

    expect(r.tipo).toBe('artefatos_invalidos')
    if (r.tipo !== 'artefatos_invalidos') return
    expect(r.problemas.map((p) => p.campo)).toContain('candidateConfigJson')
  })

  it('ferramenta pedida pela candidata é recusada aqui também', async () => {
    // A mesma whitelist do claim de revisão. Se o preview usasse uma validação própria e
    // mais frouxa, o dono aprovaria testando uma IA com poder que a revisão recusou.
    const config = JSON.parse(ARTEFATOS.candidateConfigJson)
    await db.aiSetupVersion.update({
      where: { id: versionId },
      data: {
        candidateConfigJson: JSON.stringify({
          ...config,
          tools: [{ name: 'abrir_chamado', enabled: true }],
        }),
      },
    })

    expect((await resolverFonteDoPreview(pedido())).tipo).toBe('artefatos_invalidos')
  })
})

describe('somente leitura', () => {
  it('resolver não altera a versão nem cria evento', async () => {
    const antes = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })

    await resolverFonteDoPreview(pedido())

    const depois = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(depois).toEqual(antes)
    expect(await db.aiSetupEvent.count({ where: { tenantId } })).toBe(0)
  })

  it('nem quando recusa', async () => {
    const antes = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })

    await resolverFonteDoPreview(pedido({ generation: 99 }))

    expect(await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })).toEqual(antes)
    expect(await db.aiSetupEvent.count({ where: { tenantId } })).toBe(0)
  })
})
