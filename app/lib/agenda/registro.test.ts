import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryAgenda } from './memoria'
import { executarPedido } from './pedido'
import {
  agendaDoTenant,
  definirAgenda,
  enviarConfirmacoes,
  limparAgendas,
  tratarRespostaConfirmacao,
} from './registro'

const NOW = '2026-11-16T09:00:00-03:00' // segunda; amanhã = terça 17
const AMANHA = '2026-11-17T08:00:00-03:00'
const OUTRO = '2026-11-17T09:00:00-03:00'
const mk = () =>
  createMemoryAgenda({ hours: { open: '08:00', close: '12:00' }, durationMin: 60, now: () => NOW })

beforeEach(() => limparAgendas())

describe('registro de agenda por tenant', () => {
  it('tenant sem agenda devolve null; demo tem a sua em memória', () => {
    expect(agendaDoTenant('outra-empresa')).toBeNull()
    expect(agendaDoTenant('clinica-demo')?.name).toBe('memoria')
  })
})

describe('confirmação na véspera', () => {
  const setup = async () => {
    const ag = mk()
    definirAgenda('t', ag)
    await executarPedido(ag, 'p1', { operation: 'agendar', service: 'Limpeza', start: AMANHA })
    return ag
  }

  it('gera 1 mensagem por consulta de amanhã e só uma vez', async () => {
    await setup()
    const lote = await enviarConfirmacoes('t', 'Clínica Aurora (demo)', NOW)
    expect(lote).toHaveLength(1)
    expect(lote[0].patientRef).toBe('p1')
    expect(lote[0].text).toMatch(/1 - Confirmo/)
    expect(await enviarConfirmacoes('t', 'Clínica Aurora (demo)', NOW)).toHaveLength(0)
  })

  it('sem pendência, a resposta segue o fluxo normal (null)', async () => {
    await setup()
    expect(await tratarRespostaConfirmacao('t', 'p1', '1')).toBeNull()
  })

  it('1 confirma', async () => {
    const ag = await setup()
    await enviarConfirmacoes('t', 'X', NOW)
    const r = await tratarRespostaConfirmacao('t', 'p1', '1')
    expect(r?.kind).toBe('resposta')
    expect((await ag.list())[0].status).toBe('confirmado')
  })

  it('3 cancela e libera o horário', async () => {
    const ag = await setup()
    await enviarConfirmacoes('t', 'X', NOW)
    await tratarRespostaConfirmacao('t', 'p1', '3')
    expect(await ag.freeSlots('2026-11-17')).toContain(AMANHA)
  })

  it('2 pede o novo horário e a pendência fica até remarcar', async () => {
    await setup()
    await enviarConfirmacoes('t', 'X', NOW)
    const r = await tratarRespostaConfirmacao('t', 'p1', '2')
    expect(r?.kind).toBe('resposta')
    // resposta de 2 não é confirmação: a próxima fala segue para a IA
    expect(await tratarRespostaConfirmacao('t', 'p1', OUTRO)).toBeNull()
  })

  it('resposta fora do 1/2/3 vai para a recepção', async () => {
    await setup()
    await enviarConfirmacoes('t', 'X', NOW)
    const r = await tratarRespostaConfirmacao('t', 'p1', 'sim, mas estou com um desconforto')
    expect(r?.kind).toBe('humano')
  })

  it('não mistura pacientes nem tenants', async () => {
    await setup()
    await enviarConfirmacoes('t', 'X', NOW)
    expect(await tratarRespostaConfirmacao('t', 'p2', '1')).toBeNull()
    expect(await tratarRespostaConfirmacao('outro', 'p1', '1')).toBeNull()
  })
})
