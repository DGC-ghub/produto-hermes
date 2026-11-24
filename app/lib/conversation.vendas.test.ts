import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import { generateAttendantReply } from './attendant'
import { loadTenantConfig } from './attendant/tenant-config'
import { processIncomingMessage } from './conversation.server'

// DGC-265: tenant dgc-vendas no chat web da demo. Cérebro mockado: o que se prova aqui é o
// BALCÃO — preço em texto fixo, transbordo e log — e não a conversa da IA.
vi.mock('./attendant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./attendant')>()),
  generateAttendantReply: vi.fn(async () => ({
    reply: 'resposta do cérebro mockado',
    needsHuman: false,
    handoffReason: null,
    confidence: 0.5,
    leadPatch: null,
    action: null,
  })),
}))

const CONTATO = 'test-vendas-dgc265'
const SLUG = 'dgc-vendas'
let pasta = ''

beforeAll(() => {
  pasta = mkdtempSync(join(tmpdir(), 'vendas-'))
  process.env.HERMES_TRANSBORDO_DIR = pasta
})

afterAll(() => {
  delete process.env.HERMES_TRANSBORDO_DIR
  rmSync(pasta, { recursive: true, force: true })
})

afterEach(async () => {
  vi.clearAllMocks()
  const conversas = await db.conversation.findMany({
    where: { contactId: CONTATO },
    select: { id: true },
  })
  const ids = conversas.map((c) => c.id)
  await db.message.deleteMany({ where: { conversationId: { in: ids } } })
  await db.conversation.deleteMany({ where: { id: { in: ids } } })
  rmSync(join(pasta, `${SLUG}.jsonl`), { force: true })
})

const enviar = (message: string, conversationId?: string) =>
  processIncomingMessage({
    tenantSlug: SLUG,
    message,
    contactId: CONTATO,
    mode: 'public_demo',
    conversationId,
  })

const transbordos = () => {
  try {
    return readFileSync(join(pasta, `${SLUG}.jsonl`), 'utf8')
      .trim()
      .split('\n')
      .map((linha) => JSON.parse(linha))
  } catch {
    return []
  }
}

describe('tenant dgc-vendas', () => {
  it('a config carrega e o preço fixo é o texto da base, palavra por palavra', () => {
    const config = loadTenantConfig(SLUG)
    const preco = config.fixedReplies?.find((r) => r.id === 'preco')
    const base = readFileSync(
      join(process.cwd(), 'knowledge/dgc-vendas/base_agente_vendas.md'),
      'utf8',
    )
    expect(preco).toBeDefined()
    expect(base).toContain(preco?.reply)
  })

  it('preço: responde o texto fixo e NÃO chama o cérebro', async () => {
    const r = await enviar('Quanto custa?')
    expect(generateAttendantReply).not.toHaveBeenCalled()
    expect(r.reply).toContain('R$ 990')
    expect(r.reply).toContain('R$ 690 por mês')
    expect(r.needsHuman).toBe(false)
    expect(transbordos()).toHaveLength(0)
  })

  it('LGPD: responde o texto fixo sem transbordo (o "lgpd" global não vale aqui)', async () => {
    const r = await enviar('E a LGPD, como fica com os dados dos pacientes?')
    expect(generateAttendantReply).not.toHaveBeenCalled()
    expect(r.reply).toContain('assinamos um termo de LGPD')
    expect(r.needsHuman).toBe(false)
  })

  it('pedir o termo de LGPD passa para o Gabriel e registra com resposta recomendada', async () => {
    const r = await enviar('Me manda o termo de LGPD?')
    expect(generateAttendantReply).not.toHaveBeenCalled()
    expect(r.needsHuman).toBe(true)
    expect(r.reply).toContain('o Gabriel responda direto')
    const [t] = transbordos()
    expect(t.tenantSlug).toBe(SLUG)
    expect(t.resumo).toContain('termo de LGPD')
    expect(t.respostaRecomendada).toContain('advogado')
  })

  it('desconto passa para o Gabriel e o preço nunca é calculado', async () => {
    const r = await enviar('Faz por R$ 500?')
    expect(r.needsHuman).toBe(true)
    expect(r.reply).not.toMatch(/R\$/)
    expect(transbordos()[0].respostaRecomendada).toContain('Desconto')
  })

  it('"golpe" na 1ª vez responde; na 2ª passa para o Gabriel', async () => {
    const a = await enviar('Isso é golpe?')
    expect(a.needsHuman).toBe(false)
    const b = await enviar('Isso é golpe mesmo?', a.conversationId)
    expect(b.needsHuman).toBe(true)
    expect(transbordos()).toHaveLength(1)
  })

  it('pedido para parar: responde na hora e registra', async () => {
    const r = await enviar('Por favor, pode parar de mandar mensagem')
    expect(r.reply).toBe('Combinado, não mando mais. Desculpe o incômodo.')
    expect(r.needsHuman).toBe(false)
    expect(transbordos()[0].motivo).toBe('parar')
  })

  it('fora da base: o cérebro marca needsHuman e o transbordo é registrado', async () => {
    vi.mocked(generateAttendantReply).mockResolvedValueOnce({
      reply: 'Essa eu prefiro que o Gabriel responda direto.',
      needsHuman: true,
      handoffReason: 'no_knowledge_match',
      confidence: 0.2,
      leadPatch: null,
      action: null,
    })
    const r = await enviar('Vocês integram com o sistema Feegow?')
    expect(r.needsHuman).toBe(true)
    const [t] = transbordos()
    expect(t.motivo).toBe('no_knowledge_match')
    expect(t.respostaRecomendada).toContain('não está na base')
  })

  it('sem agenda real, lead nem chamado: public_demo não grava nada operacional', async () => {
    await enviar('Quanto custa?')
    expect(await db.ticket.count({ where: { contactId: CONTATO } })).toBe(0)
  })
})
