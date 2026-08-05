import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// DOIS subprocessos, de propósito — um positivo e um fail-closed.
//
// A lógica do claim (CAS, pré-condições, conflito entre revisores) está coberta por
// integração em revisao.server.test.ts, que é mais rápida e mais específica. Aqui só fica
// o que SÓ existe no processo inteiro: a seleção do banco pelo `.env`, o modo read-only e
// a ausência de escrita antes dos gates. Repetir subprocesso por inércia custaria minutos
// da suíte sem provar nada novo.

const RAIZ = path.resolve(import.meta.dirname, '..')
const SCRIPT = path.join(RAIZ, 'scripts', 'setup-revisar.ts')

let tmp: string
let bancoTmp: string
let url: string
let slug: string

function rodar(args: string[], databaseUrl?: string) {
  try {
    const saida = execFileSync('npx', ['tsx', SCRIPT, ...args], {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      env: {
        ...process.env,
        ...(databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl }),
        VITEST: '',
        // O default de ambiente não pode preencher o revisor nos testes: o fail-closed
        // depende de ele estar mesmo ausente.
        INTERNAL_REVIEWER: '',
      },
    })
    return { saida, codigo: 0 }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number }
    return { saida: `${e.stdout ?? ''}${e.stderr ?? ''}`, codigo: e.status ?? -1 }
  }
}

/** Abre um cliente próprio no banco de brinquedo — o `db.server` está preso ao do worker. */
async function clienteDoBrinquedo() {
  const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3')
  const { PrismaClient } = await import('../generated/prisma/client.js')
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: bancoTmp }) })
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'hermes-revisar-'))
  bancoTmp = path.join(tmp, 'revisar.db')
  url = `file:${bancoTmp}`
  execFileSync('npx', ['prisma', 'db', 'push', '--url', url], {
    cwd: RAIZ,
    stdio: 'pipe',
    timeout: 120_000,
  })

  slug = `rev-${crypto.randomUUID().slice(0, 8)}`
  const cliente = await clienteDoBrinquedo()
  try {
    const tenant = await cliente.tenant.create({ data: { slug, name: 'Empresa de Teste' } })
    const setup = await cliente.aiSetup.create({ data: { tenantId: tenant.id } })
    const versao = await cliente.aiSetupVersion.create({
      data: {
        setupId: setup.id,
        tenantId: tenant.id,
        state: 'submitted',
        generation: 1,
        answersJson: '{}',
        submittedAt: new Date(),
        candidateConfigJson: JSON.stringify({
          businessProfile: { name: 'Clínica', segment: 'saúde', tone: 'cordial' },
          knowledge: { sourcePolicy: 'answer_only_from_knowledge' },
          guardrails: { neverPromise: ['prazo'] },
          escalationPolicy: {
            triggers: ['dor'],
            defaultReason: 'saude',
            humanMessage: 'Vou chamar.',
          },
          objectives: ['tirar_duvidas'],
          tools: [],
        }),
        candidateKnowledgeJson: JSON.stringify([{ title: 'FAQ', content: 'Atendemos 9h-18h.' }]),
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
      },
    })
    await cliente.aiSetup.update({
      where: { id: setup.id },
      data: { reviewVersionId: versao.id },
    })
    await cliente.aiSetupJob.create({
      data: {
        versionId: versao.id,
        tenantId: tenant.id,
        kind: 'generate',
        generation: 1,
        idempotencyKey: `${versao.id}:1:generate:1`,
        status: 'completed',
      },
    })
  } finally {
    await cliente.$disconnect()
  }
}, 180_000)

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('setup:revisar no processo real', () => {
  it('--sim mostra a situação e NÃO assume', { timeout: 120_000 }, async () => {
    const { saida, codigo } = rodar([slug, '--reviewer', 'Gabriel', '--sim'], url)

    expect(codigo).toBe(0)
    expect(saida).toContain('MODO: SIMULAÇÃO')
    expect(saida).toContain('artefatos: prontos')
    expect(saida).toContain('ninguém assumiu')
    expect(saida).toContain('nada foi assumido')

    // A prova está no banco: a saída poderia dizer qualquer coisa.
    const cliente = await clienteDoBrinquedo()
    try {
      const versao = await cliente.aiSetupVersion.findFirstOrThrow()
      expect(versao.reviewStartedAt).toBeNull()
      expect(versao.reviewer).toBeNull()
      expect(await cliente.aiSetupEvent.count()).toBe(0)
    } finally {
      await cliente.$disconnect()
    }
  })

  it('sem revisor, PARA antes de abrir o banco (fail-closed)', { timeout: 120_000 }, async () => {
    // O gate é anterior a qualquer leitura: o nome vai para a auditoria, e um comando
    // que lê primeiro e valida depois já teria aberto conexão para nada.
    const { saida, codigo } = rodar([slug], url)

    expect(codigo).not.toBe(0)
    expect(saida).toContain('Falta o revisor')
    // E nada mudou.
    const cliente = await clienteDoBrinquedo()
    try {
      expect((await cliente.aiSetupVersion.findFirstOrThrow()).reviewStartedAt).toBeNull()
    } finally {
      await cliente.$disconnect()
    }
  })
})

describe('a colisão de flag não pode virar escrita', () => {
  it('--reviewer --sim NÃO assume e NÃO perde a simulação', { timeout: 120_000 }, async () => {
    // Era o pior desfecho de um erro de digitação: o parser consumia `--sim` como NOME,
    // a simulação desaparecia e o comando assumia a revisão com o revisor "--sim".
    // Merece subprocesso porque é uma colisão de linha de comando que causava escrita.
    const { saida, codigo } = rodar([slug, '--reviewer', '--sim'], url)

    expect(codigo).not.toBe(0)
    expect(saida).toContain('precisa de um NOME')
    // Nada de "MODO: EXECUÇÃO": o comando parou antes de decidir modo.
    expect(saida).not.toContain('MODO: EXECUÇÃO')

    const cliente = await clienteDoBrinquedo()
    try {
      const versao = await cliente.aiSetupVersion.findFirstOrThrow()
      expect(versao.reviewStartedAt).toBeNull()
      expect(versao.reviewer).toBeNull()
      expect(await cliente.aiSetupEvent.count()).toBe(0)
    } finally {
      await cliente.$disconnect()
    }
  })
})
