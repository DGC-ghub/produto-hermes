import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db.server'
import { assumirRevisao, olharRevisao } from './revisao.server'

// Integração com o banco de teste. O claim de revisão depende do `updateMany` condicional
// REAL: é ele que impede dois revisores de trabalharem no mesmo material sem saber. As
// regras puras (reviewer, artefatos) estão em revisao.test.ts.

let tenantId: string
let slug: string
let setupId: string
let versionId: string

/**
 * Artefatos que o produto CONSEGUE usar. O conjunto anterior — `{"slug":"acme"}` como
 * config, uma pergunta na validação — era reprovado pelo próprio parser do motor: os testes
 * chamavam de válido material impossível de carregar.
 */
const ARTEFATOS = {
  candidateConfigJson: JSON.stringify({
    businessProfile: { name: 'Clínica', segment: 'saúde', tone: 'cordial' },
    knowledge: { sourcePolicy: 'answer_only_from_knowledge' },
    guardrails: { neverPromise: ['prazo'] },
    escalationPolicy: { triggers: ['dor'], defaultReason: 'saude', humanMessage: 'Vou chamar.' },
    objectives: ['tirar_duvidas'],
    tools: [],
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

/** Monta o cenário FELIZ: versão submetida, job concluído, artefatos prontos. */
async function cenarioPronto() {
  await db.aiSetupVersion.update({ where: { id: versionId }, data: ARTEFATOS })
  await db.aiSetupJob.create({
    data: {
      versionId,
      tenantId,
      kind: 'generate',
      generation: 1,
      idempotencyKey: `${versionId}:1:generate:1`,
      status: 'completed',
    },
  })
}

const REVISOR = { reviewer: 'Gabriel', hostname: 'pi-hermes', usuarioDoProcesso: 'pi' }

beforeEach(async () => {
  slug = `rev-${crypto.randomUUID().slice(0, 8)}`
  const tenant = await db.tenant.create({ data: { slug, name: 'Tenant de teste' } })
  tenantId = tenant.id
  setupId = (await db.aiSetup.create({ data: { tenantId } })).id
  versionId = (
    await db.aiSetupVersion.create({
      data: {
        setupId,
        tenantId,
        state: 'submitted',
        generation: 1,
        answersJson: '{}',
        submittedAt: new Date(),
      },
    })
  ).id
  await db.aiSetup.update({ where: { id: setupId }, data: { reviewVersionId: versionId } })
})

describe('assumir a revisão', () => {
  it('cenário pronto: assume, marca o dono e registra o evento', async () => {
    await cenarioPronto()

    const resultado = await assumirRevisao({ tenantSlug: slug, ...REVISOR })

    expect(resultado).toMatchObject({ tipo: 'assumida', versionId, generation: 1 })

    const versao = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(versao.reviewer).toBe('Gabriel')
    expect(versao.reviewStartedAt).not.toBeNull()
    // O estado NÃO muda: assumir não é aprovar.
    expect(versao.state).toBe('submitted')

    const evento = await db.aiSetupEvent.findFirst({ where: { versionId, kind: 'review_started' } })
    // O ator leva a máquina junto (§11.2).
    expect(evento?.actor).toBe('internal:Gabriel@pi-hermes')
    // O usuário do PROCESSO vai junto (§11.2): o nome digitado é declarado por quem roda o
    // comando, a conta do sistema é o que o sistema observou. Discordância é investigável.
    expect(JSON.parse(evento?.detail ?? '{}')).toEqual({ generation: 1, processUser: 'pi' })
  })

  it('o SEGUNDO revisor recebe conflito, com o nome de quem assumiu (critério 21)', async () => {
    // Sem isto os dois trabalham no mesmo material e o segundo só descobre quando o
    // primeiro já mudou o estado.
    await cenarioPronto()
    await assumirRevisao({ tenantSlug: slug, ...REVISOR })

    const segundo = await assumirRevisao({
      tenantSlug: slug,
      reviewer: 'Ana',
      hostname: 'outro-pc',
      usuarioDoProcesso: 'pi',
    })

    expect(segundo.tipo).toBe('ja_assumida')
    if (segundo.tipo === 'ja_assumida') {
      expect(segundo.reviewer).toBe('Gabriel')
      expect(segundo.desde).not.toBeNull()
    }
    // E o dono não foi trocado.
    expect((await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })).reviewer).toBe(
      'Gabriel',
    )
  })

  it('dois claims CONCORRENTES: só um assume', async () => {
    await cenarioPronto()

    const [a, b] = await Promise.all([
      assumirRevisao({
        tenantSlug: slug,
        reviewer: 'Gabriel',
        hostname: 'h1',
        usuarioDoProcesso: 'pi',
      }),
      assumirRevisao({
        tenantSlug: slug,
        reviewer: 'Ana',
        hostname: 'h2',
        usuarioDoProcesso: 'pi',
      }),
    ])

    expect([a, b].filter((r) => r.tipo === 'assumida')).toHaveLength(1)
    expect(await db.aiSetupEvent.count({ where: { versionId, kind: 'review_started' } })).toBe(1)
  })
})

describe('o reviewer é validado NA FRONTEIRA DO SERVIDOR', () => {
  // A CLI já normaliza, mas ela não é a única porta: um teste, um worker ou um script
  // futuro chamando `assumirRevisao` direto gravaria um claim com identidade inútil, e
  // "quem assumiu esta revisão?" ficaria sem resposta.

  it.each([
    [' '],
    [''],
    ['  \t '],
    ['ab'],
  ])('reviewer %j é recusado sem tocar no banco', async (nome) => {
    await cenarioPronto()

    const resultado = await assumirRevisao({
      tenantSlug: slug,
      reviewer: nome,
      hostname: 'host',
      usuarioDoProcesso: 'pi',
    })

    expect(resultado.tipo).toBe('reviewer_invalido')
    const versao = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(versao.reviewStartedAt).toBeNull()
    expect(versao.reviewer).toBeNull()
    expect(await db.aiSetupEvent.count({ where: { versionId } })).toBe(0)
  })

  it('o servidor grava a forma NORMALIZADA, não a que recebeu', async () => {
    // Não basta recusar vazio: a fronteira precisa ser a autoridade da forma persistida,
    // senão "Ana   Maria" e "Ana Maria" viram dois revisores diferentes na auditoria.
    await cenarioPronto()

    const resultado = await assumirRevisao({
      tenantSlug: slug,
      reviewer: '  Ana   Maria  ',
      hostname: 'host',
      usuarioDoProcesso: 'pi',
    })

    expect(resultado).toMatchObject({ tipo: 'assumida', reviewer: 'Ana Maria' })
    expect((await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })).reviewer).toBe(
      'Ana Maria',
    )
    const evento = await db.aiSetupEvent.findFirst({ where: { versionId, kind: 'review_started' } })
    expect(evento?.actor).toBe('internal:Ana Maria@host')
  })
})

describe('pré-condições (§11.1): não se assume o que não está pronto', () => {
  it('sem job concluído, recusa — o relógio mediria ESPERA, não trabalho', async () => {
    await db.aiSetupVersion.update({ where: { id: versionId }, data: ARTEFATOS })
    await db.aiSetupJob.create({
      data: {
        versionId,
        tenantId,
        kind: 'generate',
        generation: 1,
        idempotencyKey: `${versionId}:1:generate:1`,
        status: 'pending',
      },
    })

    const resultado = await assumirRevisao({ tenantSlug: slug, ...REVISOR })

    expect(resultado).toEqual({ tipo: 'job_nao_concluido', statusDoJob: 'pending' })
    expect(
      (await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })).reviewStartedAt,
    ).toBeNull()
  })

  it('sem job nenhum, recusa', async () => {
    await db.aiSetupVersion.update({ where: { id: versionId }, data: ARTEFATOS })
    expect(await assumirRevisao({ tenantSlug: slug, ...REVISOR })).toEqual({
      tipo: 'job_nao_concluido',
      statusDoJob: null,
    })
  })

  it('job concluído de OUTRA geração não vale', async () => {
    // Um job da geração anterior não diz nada sobre os artefatos que estão na linha agora.
    await db.aiSetupVersion.update({
      where: { id: versionId },
      data: { ...ARTEFATOS, generation: 2 },
    })
    await db.aiSetupJob.create({
      data: {
        versionId,
        tenantId,
        kind: 'generate',
        generation: 1,
        idempotencyKey: `${versionId}:1:generate:1`,
        status: 'completed',
      },
    })

    expect((await assumirRevisao({ tenantSlug: slug, ...REVISOR })).tipo).toBe('job_nao_concluido')
  })

  it('artefatos faltando: recusa e DIZ o que falta', async () => {
    await db.aiSetupJob.create({
      data: {
        versionId,
        tenantId,
        kind: 'generate',
        generation: 1,
        idempotencyKey: `${versionId}:1:generate:1`,
        status: 'completed',
      },
    })

    const resultado = await assumirRevisao({ tenantSlug: slug, ...REVISOR })

    expect(resultado.tipo).toBe('artefatos_ausentes')
    if (resultado.tipo === 'artefatos_ausentes') {
      // Saber O QUE faltou é o que decide entre rodar o job de novo e investigar.
      expect(resultado.problemas.map((p) => p.campo)).toContain('candidateConfigJson')
    }
  })

  it('config que o MOTOR não carregaria é recusada', async () => {
    // O caso concreto: `{"slug":"acme"}` passava pela validação anterior. Assumir a
    // revisão dele iniciaria o relógio humano sobre material inútil.
    await cenarioPronto()
    await db.aiSetupVersion.update({
      where: { id: versionId },
      data: { candidateConfigJson: '{"slug":"acme"}' },
    })

    const resultado = await assumirRevisao({ tenantSlug: slug, ...REVISOR })

    expect(resultado.tipo).toBe('artefatos_ausentes')
    if (resultado.tipo === 'artefatos_ausentes') {
      expect(resultado.problemas[0].motivo).toContain('o motor não carregaria')
    }
    expect(
      (await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })).reviewStartedAt,
    ).toBeNull()
  })

  it('UMA pergunta de validação não é prova', async () => {
    await cenarioPronto()
    await db.aiSetupVersion.update({
      where: { id: versionId },
      data: {
        validationJson:
          '[{"id":"q1","question":"a?","expectedFacts":["f"],"expectedBehavior":"b","shouldHandoff":false}]',
      },
    })

    expect((await assumirRevisao({ tenantSlug: slug, ...REVISOR })).tipo).toBe('artefatos_ausentes')
  })

  it('job completed de OUTRO kind não satisfaz a pré-condição', async () => {
    // Um job de outro tipo (ou corrompido) com `completed` provaria nada sobre a geração
    // da candidata.
    await db.aiSetupVersion.update({ where: { id: versionId }, data: ARTEFATOS })
    await db.aiSetupJob.create({
      data: {
        versionId,
        tenantId,
        kind: 'outra_coisa',
        generation: 1,
        idempotencyKey: `${versionId}:1:outra:1`,
        status: 'completed',
      },
    })

    expect(await assumirRevisao({ tenantSlug: slug, ...REVISOR })).toEqual({
      tipo: 'job_nao_concluido',
      statusDoJob: null,
    })
  })

  it('base publicada mudou depois da submissão: recusa (§4.8)', async () => {
    // A candidata raciocinou sobre uma configuração que já não é a vigente. Revisar isso
    // aprovaria o desfazimento de uma correção que já está no ar.
    await cenarioPronto()
    const publicada = await db.aiSetupVersion.create({
      data: { setupId, tenantId, state: 'active', answersJson: '{}', publishedAt: new Date() },
    })
    await db.aiSetup.update({
      where: { id: setupId },
      data: { publishedVersionId: publicada.id },
    })

    expect(await assumirRevisao({ tenantSlug: slug, ...REVISOR })).toEqual({ tipo: 'base_mudou' })
  })

  it.each([
    ['draft'],
    ['needs_changes'],
    ['ready_to_test'],
    ['active'],
  ])('versão em %s não é revisável', async (estado) => {
    await cenarioPronto()
    await db.aiSetupVersion.update({ where: { id: versionId }, data: { state: estado } })

    expect(await assumirRevisao({ tenantSlug: slug, ...REVISOR })).toEqual({
      tipo: 'estado_invalido',
      estado,
    })
  })

  it('tenant desconhecido', async () => {
    expect(await assumirRevisao({ tenantSlug: 'nao-existe', ...REVISOR })).toEqual({
      tipo: 'tenant_desconhecido',
    })
  })

  it('tenant sem versão pendente', async () => {
    await db.aiSetup.update({ where: { id: setupId }, data: { reviewVersionId: null } })
    expect(await assumirRevisao({ tenantSlug: slug, ...REVISOR })).toEqual({
      tipo: 'nada_pendente',
    })
  })

  it('nenhuma recusa deixa rastro no banco', async () => {
    // Uma recusa que marcasse `reviewStartedAt` travaria a versão para todo mundo.
    await assumirRevisao({ tenantSlug: slug, ...REVISOR })

    const versao = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(versao.reviewStartedAt).toBeNull()
    expect(versao.reviewer).toBeNull()
    expect(await db.aiSetupEvent.count({ where: { versionId } })).toBe(0)
  })
})

describe('olhar sem tocar', () => {
  it('mostra o estado e o que falta, sem assumir nada', async () => {
    await cenarioPronto()

    const visao = await olharRevisao(slug)

    expect(visao?.versao?.state).toBe('submitted')
    expect(visao?.problemas).toEqual([])
    expect(visao?.baseValida).toBe(true)
    expect(visao?.job?.status).toBe('completed')

    // Nada foi marcado.
    const versao = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(versao.reviewStartedAt).toBeNull()
    expect(await db.aiSetupEvent.count({ where: { versionId } })).toBe(0)
  })

  it('tenant desconhecido devolve null', async () => {
    expect(await olharRevisao('nao-existe')).toBeNull()
  })
})
