import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { action, loader } from '../routes/demo.chat'
import {
  checkVisitorQuota,
  DEMO_MAX_PER_VISITOR,
  DEMO_MESSAGE_MAX_CHARS,
  demoContactId,
  demoVisitorCookie,
  isVisitorId,
  readDemoVisitor,
  truncateDemoMessage,
} from './demo-visitor.server'
import type { RateState } from './rate-limit'
import { ensureInitialTenants } from './tenants.server'

// ── Ajudantes ───────────────────────────────────────────────────────────────

/** Monta o cabeçalho Cookie de um visitante já identificado (só "nome=valor"). */
async function cookieFor(visitorId: string): Promise<string> {
  const serialized = await demoVisitorCookie.serialize(visitorId)
  return serialized.split(';')[0]
}

const contactsToClean = new Set<string>()

function track(visitorId: string): string {
  const contactId = demoContactId(visitorId)
  contactsToClean.add(contactId)
  return contactId
}

// Limpa só o que os testes criaram (contactIds próprios) — nunca dados de outros.
afterAll(async () => {
  const contactIds = [...contactsToClean]
  const conversations = await db.conversation.findMany({
    where: { contactId: { in: contactIds } },
    select: { id: true },
  })
  const ids = conversations.map((c) => c.id)
  await db.ticket.deleteMany({ where: { contactId: { in: contactIds } } })
  if (ids.length > 0) {
    await db.handoffEvent.deleteMany({ where: { conversationId: { in: ids } } })
    await db.lead.deleteMany({ where: { conversationId: { in: ids } } })
    await db.message.deleteMany({ where: { conversationId: { in: ids } } })
    await db.conversation.deleteMany({ where: { id: { in: ids } } })
  }
})

// ── Lógica pura ─────────────────────────────────────────────────────────────

describe('identidade do visitante', () => {
  it('deriva o contactId do id do cookie', () => {
    expect(demoContactId('11111111-2222-4333-8444-555555555555')).toBe(
      'demo-11111111-2222-4333-8444-555555555555',
    )
  })

  it('só aceita id no formato que a gente emite', () => {
    expect(isVisitorId(crypto.randomUUID())).toBe(true)
    expect(isVisitorId('556299517799')).toBe(false)
    expect(isVisitorId('')).toBe(false)
    expect(isVisitorId(null)).toBe(false)
  })

  it('reaproveita o cookie válido e não reemite', async () => {
    const visitorId = crypto.randomUUID()
    const request = new Request('http://localhost/demo/chat', {
      headers: { Cookie: await cookieFor(visitorId) },
    })
    const visitor = await readDemoVisitor(request)
    expect(visitor.visitorId).toBe(visitorId)
    expect(visitor.setCookie).toBeNull()
  })

  it('cria identidade nova quando não há cookie, e devolve o Set-Cookie httpOnly', async () => {
    const visitor = await readDemoVisitor(new Request('http://localhost/demo/chat'))
    expect(isVisitorId(visitor.visitorId)).toBe(true)
    expect(visitor.setCookie).toContain('HttpOnly')
    expect(visitor.setCookie).toContain('SameSite=Lax')
  })

  it('ignora cookie forjado (sem assinatura válida) e cria outro', async () => {
    const request = new Request('http://localhost/demo/chat', {
      headers: { Cookie: 'hermes_demo_visitor=11111111-2222-4333-8444-555555555555' },
    })
    const visitor = await readDemoVisitor(request)
    expect(visitor.visitorId).not.toBe('11111111-2222-4333-8444-555555555555')
    expect(visitor.setCookie).not.toBeNull()
  })
})

describe('truncateDemoMessage', () => {
  it('corta a mensagem gigante no teto', () => {
    expect(truncateDemoMessage('a'.repeat(9000))).toHaveLength(DEMO_MESSAGE_MAX_CHARS)
  })

  it('não mexe na mensagem normal', () => {
    expect(truncateDemoMessage('quanto custa?')).toBe('quanto custa?')
  })
})

describe('checkVisitorQuota', () => {
  it('libera até o teto e barra a mensagem seguinte do mesmo visitante', () => {
    const states = new Map<string, RateState>()
    const visitorId = crypto.randomUUID()
    for (let i = 0; i < DEMO_MAX_PER_VISITOR; i++) {
      expect(checkVisitorQuota(1_000_000 + i, states, visitorId).allowed).toBe(true)
    }
    const over = checkVisitorQuota(1_000_100, states, visitorId)
    expect(over.allowed).toBe(false)
    expect(over.retryAfterSec).toBeGreaterThan(0)
  })

  it('o orçamento é POR visitante: quem estourou não derruba o vizinho', () => {
    const states = new Map<string, RateState>()
    const glutton = crypto.randomUUID()
    const neighbor = crypto.randomUUID()
    for (let i = 0; i <= DEMO_MAX_PER_VISITOR; i++) {
      checkVisitorQuota(1_000_000 + i, states, glutton)
    }
    expect(checkVisitorQuota(1_000_100, states, glutton).allowed).toBe(false)
    expect(checkVisitorQuota(1_000_100, states, neighbor).allowed).toBe(true)
  })
})

// ── A rota (isolamento entre visitantes) ────────────────────────────────────

describe('/demo/chat — isolamento entre visitantes', () => {
  it('não mostra a conversa de outro visitante, nem pelo id na URL', async () => {
    await ensureInitialTenants()
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: 'dgc' } })

    const visitorB = crypto.randomUUID()
    const conversationB = await db.conversation.create({
      data: { tenantId: tenant.id, contactId: track(visitorB), channel: 'simulator' },
    })
    await db.message.create({
      data: { conversationId: conversationB.id, role: 'user', content: 'segredo do visitante B' },
    })

    const visitorA = crypto.randomUUID()
    track(visitorA)
    const url = `http://localhost/demo/chat?tenant=dgc&conversationId=${conversationB.id}`
    const asA = await loader({
      request: new Request(url, { headers: { Cookie: await cookieFor(visitorA) } }),
    } as never)
    expect(asA.data.selectedConversationId).toBeNull()
    expect(asA.data.messages).toEqual([])

    // O dono continua enxergando a própria conversa.
    const asB = await loader({
      request: new Request(url, { headers: { Cookie: await cookieFor(visitorB) } }),
    } as never)
    expect(asB.data.selectedConversationId).toBe(conversationB.id)
    expect(asB.data.messages).toHaveLength(1)
  })

  it('ignora o contactId do formulário e grava sob a identidade do cookie', async () => {
    const visitorId = crypto.randomUUID()
    const contactId = track(visitorId)

    const body = new FormData()
    body.set('tenantSlug', 'dgc')
    body.set('contactId', '556299517799') // tentativa de se passar por outro contato
    body.set('message', 'quanto custa a abertura de empresa?')

    const response = (await action({
      request: new Request('http://localhost/demo/chat', {
        method: 'POST',
        headers: { Cookie: await cookieFor(visitorId) },
        body,
      }),
    } as never)) as Response

    const location = response.headers.get('Location') ?? ''
    const conversationId = new URL(location, 'http://localhost').searchParams.get('conversationId')
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: String(conversationId) },
    })
    expect(conversation.contactId).toBe(contactId)
    expect(
      await db.conversation.count({
        where: { contactId: '556299517799', tenantId: conversation.tenantId },
      }),
    ).toBe(0)
  })

  it('trunca a mensagem gigante antes de processar', async () => {
    const visitorId = crypto.randomUUID()
    track(visitorId)

    const body = new FormData()
    body.set('tenantSlug', 'dgc')
    body.set('message', `${'a'.repeat(9000)} preço`)

    const response = (await action({
      request: new Request('http://localhost/demo/chat', {
        method: 'POST',
        headers: { Cookie: await cookieFor(visitorId) },
        body,
      }),
    } as never)) as Response

    const location = response.headers.get('Location') ?? ''
    const conversationId = new URL(location, 'http://localhost').searchParams.get('conversationId')
    const userMessage = await db.message.findFirstOrThrow({
      where: { conversationId: String(conversationId), role: 'user' },
    })
    expect(userMessage.content).toHaveLength(DEMO_MESSAGE_MAX_CHARS)
  })

  it('estourando o teto do visitante, responde com o convite para criar a conta', async () => {
    const visitorId = crypto.randomUUID()
    track(visitorId)
    const cookie = await cookieFor(visitorId)

    // Mensagem vazia consome cota (o orçamento é cobrado antes de qualquer trabalho caro)
    // e não gasta o cérebro — é o jeito barato de chegar no teto neste teste.
    const send = async () => {
      const body = new FormData()
      body.set('tenantSlug', 'dgc')
      body.set('message', '')
      return action({
        request: new Request('http://localhost/demo/chat', {
          method: 'POST',
          headers: { Cookie: cookie },
          body,
        }),
      } as never)
    }

    for (let i = 0; i < DEMO_MAX_PER_VISITOR; i++) {
      await send()
    }
    const blocked = (await send()) as { data: { error: string; limitReached: boolean } }
    expect(blocked.data.limitReached).toBe(true)
    expect(blocked.data.error).toContain(String(DEMO_MAX_PER_VISITOR))
  })
})
