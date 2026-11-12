import { beforeEach, describe, expect, it, vi } from 'vitest'

const envio = vi.hoisted(() => ({ falharPara: new Set<string>() }))
vi.mock('../operator-reply.server', () => ({
  sendOperatorReply: vi.fn(async ({ contactId }: { contactId: string }) =>
    envio.falharPara.has(contactId) ? { ok: false, error: 'falhou' } : { ok: true },
  ),
}))

const { sendOperatorReply } = await import('../operator-reply.server')
const { enviarConfirmacoesDeAmanha } = await import('./confirmacoes.server')
const { createMemoryAgenda } = await import('./memoria')
const { definirAgenda, limparAgendas } = await import('./registro')

const NOW = '2026-11-16T09:00:00-03:00'
const op = { tenantId: 't1', tenantSlug: 'clin', tenantName: 'Clínica Aurora (demo)' }

beforeEach(async () => {
  vi.clearAllMocks()
  envio.falharPara.clear()
  limparAgendas()
  const ag = createMemoryAgenda({
    hours: { open: '08:00', close: '12:00' },
    durationMin: 60,
    now: () => NOW,
  })
  definirAgenda('clin', ag)
  await ag.book({ patientRef: 'p1', service: 'Limpeza', start: '2026-11-17T08:00:00-03:00' })
  await ag.book({ patientRef: 'p2', service: 'Limpeza', start: '2026-11-17T09:00:00-03:00' })
  await ag.book({ patientRef: 'p3', service: 'Limpeza', start: '2026-11-19T09:00:00-03:00' })
})

describe('botão "enviar confirmações de amanhã"', () => {
  it('manda 1 mensagem por consulta de amanhã, só para quem marcou', async () => {
    const r = await enviarConfirmacoesDeAmanha(op, NOW)
    expect(r).toEqual({ enviadas: 2, falhas: 0 })
    expect(sendOperatorReply).toHaveBeenCalledTimes(2)
    const alvos = vi.mocked(sendOperatorReply).mock.calls.map((c) => c[0].contactId)
    expect(alvos.sort()).toEqual(['p1', 'p2'])
  })

  it('clicar de novo não repete a mensagem', async () => {
    await enviarConfirmacoesDeAmanha(op, NOW)
    const r = await enviarConfirmacoesDeAmanha(op, NOW)
    expect(r).toEqual({ enviadas: 0, falhas: 0 })
    expect(sendOperatorReply).toHaveBeenCalledTimes(2)
  })

  it('envio que falha conta como falha e pode ser tentado de novo', async () => {
    envio.falharPara.add('p2')
    expect(await enviarConfirmacoesDeAmanha(op, NOW)).toEqual({ enviadas: 1, falhas: 1 })
    envio.falharPara.clear()
    expect(await enviarConfirmacoesDeAmanha(op, NOW)).toEqual({ enviadas: 1, falhas: 0 })
  })

  it('tenant sem agenda não envia nada', async () => {
    const r = await enviarConfirmacoesDeAmanha({ ...op, tenantSlug: 'sem-agenda' }, NOW)
    expect(r).toEqual({ enviadas: 0, falhas: 0 })
  })
})
