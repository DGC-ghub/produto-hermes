import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import type { TraceResult } from './metrics'
import {
  __resetPruneCounter,
  metricsEnabled,
  parseSteps,
  pruneOldTraces,
  readLatencyReport,
  recordMessageTrace,
} from './metrics.server'

const SLUG = 'zzz-metrics'
const OTHER_SLUG = 'zzz-metrics-outro'

async function makeTenant(slug: string): Promise<string> {
  const tenant = await db.tenant.create({ data: { slug, name: slug } })
  return tenant.id
}

function trace(totalMs: number, steps: Record<string, number>): TraceResult {
  return { totalMs, steps }
}

beforeEach(() => {
  __resetPruneCounter()
})

afterEach(async () => {
  for (const slug of [SLUG, OTHER_SLUG]) {
    const tenant = await db.tenant.findUnique({ where: { slug } })
    if (tenant) {
      await db.messageTrace.deleteMany({ where: { tenantId: tenant.id } })
      await db.tenant.delete({ where: { id: tenant.id } })
    }
  }
  vi.unstubAllEnvs()
})

describe('recordMessageTrace', () => {
  it('grava a medição e o relatório a devolve agregada', async () => {
    const tenantId = await makeTenant(SLUG)
    await recordMessageTrace({
      tenantId,
      channel: 'whatsapp',
      provider: 'claude_cli',
      outcome: 'ok',
      trace: trace(21_700, { brain: 21_000, retrieval: 40 }),
    })

    const report = await readLatencyReport({ tenantSlug: SLUG })
    expect(report.total.count).toBe(1)
    expect(report.total.p50Ms).toBe(21_700)
    expect(report.steps.brain.p50Ms).toBe(21_000)
    expect(report.outcomes).toEqual({ ok: 1 })
    expect(report.providers).toEqual({ claude_cli: 1 })
  })

  it('desnormaliza brainMs para consulta barata do gargalo', async () => {
    const tenantId = await makeTenant(SLUG)
    await recordMessageTrace({
      tenantId,
      channel: 'whatsapp',
      provider: 'claude_cli',
      outcome: 'ok',
      trace: trace(21_700, { brain: 21_000 }),
    })
    const row = await db.messageTrace.findFirst({ where: { tenantId } })
    expect(row?.brainMs).toBe(21_000)
  })

  it('deixa brainMs nulo quando o cérebro nem foi chamado', async () => {
    const tenantId = await makeTenant(SLUG)
    await recordMessageTrace({
      tenantId,
      channel: 'whatsapp',
      provider: 'nenhum',
      outcome: 'guard_handoff',
      trace: trace(120, { retrieval: 30 }),
    })
    const row = await db.messageTrace.findFirst({ where: { tenantId } })
    expect(row?.brainMs).toBeNull()
  })

  it('NÃO lança quando a gravação falha — medir não pode quebrar o atendimento', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    // tenantId inexistente viola a FK: o insert falha de propósito.
    await expect(
      recordMessageTrace({
        tenantId: 'tenant-que-nao-existe',
        channel: 'whatsapp',
        provider: 'claude_cli',
        outcome: 'ok',
        trace: trace(100, {}),
      }),
    ).resolves.toBeUndefined()
    expect(erro).toHaveBeenCalled()
    erro.mockRestore()
  })

  it('não grava nada com HERMES_METRICS=0', async () => {
    const tenantId = await makeTenant(SLUG)
    vi.stubEnv('HERMES_METRICS', '0')
    expect(metricsEnabled()).toBe(false)
    await recordMessageTrace({
      tenantId,
      channel: 'whatsapp',
      provider: 'claude_cli',
      outcome: 'ok',
      trace: trace(100, {}),
    })
    expect(await db.messageTrace.count({ where: { tenantId } })).toBe(0)
  })
})

describe('readLatencyReport', () => {
  it('isola por tenant — a demo pública não polui os números do cliente pagante', async () => {
    const mine = await makeTenant(SLUG)
    const other = await makeTenant(OTHER_SLUG)
    await recordMessageTrace({
      tenantId: mine,
      channel: 'whatsapp',
      provider: 'claude_cli',
      outcome: 'ok',
      trace: trace(20_000, { brain: 19_000 }),
    })
    await recordMessageTrace({
      tenantId: other,
      channel: 'simulator',
      provider: 'mock',
      outcome: 'ok',
      trace: trace(50, { brain: 10 }),
    })

    const report = await readLatencyReport({ tenantSlug: SLUG })
    expect(report.total.count).toBe(1)
    expect(report.total.p50Ms).toBe(20_000)
  })

  it('devolve relatório vazio para slug inexistente (não ignora o filtro)', async () => {
    const tenantId = await makeTenant(SLUG)
    await recordMessageTrace({
      tenantId,
      channel: 'whatsapp',
      provider: 'claude_cli',
      outcome: 'ok',
      trace: trace(20_000, { brain: 19_000 }),
    })
    const report = await readLatencyReport({ tenantSlug: 'nao-existe-esse-slug' })
    expect(report.total.count).toBe(0)
  })

  it('respeita a janela de tempo', async () => {
    const tenantId = await makeTenant(SLUG)
    await db.messageTrace.create({
      data: {
        tenantId,
        channel: 'whatsapp',
        provider: 'claude_cli',
        outcome: 'ok',
        totalMs: 999,
        stepsJson: '{}',
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3h atrás
      },
    })
    expect((await readLatencyReport({ tenantSlug: SLUG, windowMinutes: 60 })).total.count).toBe(0)
    expect((await readLatencyReport({ tenantSlug: SLUG, windowMinutes: 240 })).total.count).toBe(1)
  })
})

describe('parseSteps', () => {
  it('lê o mapa de etapas', () => {
    expect(parseSteps('{"brain":21000,"retrieval":40}')).toEqual({ brain: 21_000, retrieval: 40 })
  })

  it('tolera JSON quebrado, tipo errado e valores não numéricos', () => {
    expect(parseSteps('{quebrado')).toEqual({})
    expect(parseSteps('[1,2]')).toEqual({})
    expect(parseSteps('null')).toEqual({})
    expect(parseSteps('{"brain":"vinte","ok":10}')).toEqual({ ok: 10 })
  })
})

describe('pruneOldTraces', () => {
  it('apaga além da retenção e preserva o que está dentro', async () => {
    const tenantId = await makeTenant(SLUG)
    const base = {
      tenantId,
      channel: 'whatsapp',
      provider: 'claude_cli',
      outcome: 'ok',
      totalMs: 100,
      stepsJson: '{}',
    }
    await db.messageTrace.create({
      data: { ...base, createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    })
    await db.messageTrace.create({ data: base })

    await pruneOldTraces(14)
    expect(await db.messageTrace.count({ where: { tenantId } })).toBe(1)
  })
})
