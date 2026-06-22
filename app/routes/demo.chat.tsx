import { Form, Link, redirect } from 'react-router'
import { db } from '../db.server'
import { processIncomingMessage } from '../lib/conversation.server'
import { ensureInitialTenants, INITIAL_TENANTS } from '../lib/tenants.server'
import type { Route } from './+types/demo.chat'

const ALLOWED_SLUGS: readonly string[] = INITIAL_TENANTS.map((tenant) => tenant.slug)
const DEFAULT_SLUG = 'dgc'
const RECENT_LIMIT = 10

function resolveTenantSlug(value: string | null): string {
  return value && ALLOWED_SLUGS.includes(value) ? value : DEFAULT_SLUG
}

type MessageSource = { fileName: string; title: string; score: number }

function parseSources(sourcesJson: string | null): MessageSource[] {
  if (!sourcesJson) {
    return []
  }
  try {
    const parsed = JSON.parse(sourcesJson)
    return Array.isArray(parsed) ? (parsed as MessageSource[]) : []
  } catch {
    return []
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  await ensureInitialTenants()

  const url = new URL(request.url)
  const tenantSlug = resolveTenantSlug(url.searchParams.get('tenant'))
  const conversationId = url.searchParams.get('conversationId')

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } })

  const conversations = tenant
    ? await db.conversation.findMany({
        where: { tenantId: tenant.id },
        orderBy: { updatedAt: 'desc' },
        take: RECENT_LIMIT,
        select: { id: true, contactId: true, status: true, updatedAt: true },
      })
    : []

  const selected =
    conversationId && tenant
      ? await db.conversation.findFirst({
          where: { id: conversationId, tenantId: tenant.id },
          select: { id: true, status: true },
        })
      : null

  const messages = selected
    ? await db.message.findMany({
        where: { conversationId: selected.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, confidence: true, sourcesJson: true },
      })
    : []

  return {
    tenantSlug,
    tenants: INITIAL_TENANTS.map((t) => ({ slug: t.slug, name: t.name })),
    conversations: conversations.map((c) => ({
      id: c.id,
      contactId: c.contactId,
      status: c.status,
      updatedAt: c.updatedAt.toISOString(),
    })),
    selectedConversationId: selected?.id ?? null,
    selectedStatus: selected?.status ?? null,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      confidence: m.confidence,
      sources: parseSources(m.sourcesJson),
    })),
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const tenantSlug = resolveTenantSlug(String(formData.get('tenantSlug') ?? ''))
  const message = String(formData.get('message') ?? '')
  const conversationIdRaw = formData.get('conversationId')
  const contactIdRaw = formData.get('contactId')

  // Mensagem vazia: volta sem processar (o textarea já tem `required`, isto é só defesa).
  if (message.trim().length === 0) {
    const back = conversationIdRaw ? `&conversationId=${conversationIdRaw}` : ''
    return redirect(`/demo/chat?tenant=${tenantSlug}${back}`)
  }

  const result = await processIncomingMessage({
    tenantSlug,
    message,
    conversationId: conversationIdRaw ? String(conversationIdRaw) : undefined,
    contactId: contactIdRaw ? String(contactIdRaw) : undefined,
  })

  return redirect(`/demo/chat?tenant=${result.tenantSlug}&conversationId=${result.conversationId}`)
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Produto Hermes — Simulador' },
    { name: 'description', content: 'Simulador de atendimento por IA (MVP simulado).' },
  ]
}

export default function DemoChat({ loaderData }: Route.ComponentProps) {
  const { tenantSlug, tenants, conversations, selectedConversationId, selectedStatus, messages } =
    loaderData
  const needsHuman = selectedStatus === 'needs_human'
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Produto Hermes — Simulador</h1>
        <p className="text-sm text-amber-700">MVP simulado — sem WhatsApp real ainda.</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-600">Empresa</h2>
        <div className="flex flex-wrap gap-2">
          {tenants.map((tenant) => (
            <Link
              key={tenant.slug}
              to={`/demo/chat?tenant=${tenant.slug}`}
              className={`rounded border px-3 py-1 text-sm ${
                tenant.slug === tenantSlug
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700'
              }`}
            >
              {tenant.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-600">Conversas recentes</h2>
        {conversations.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma conversa ainda.</p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  to={`/demo/chat?tenant=${tenantSlug}&conversationId=${conversation.id}`}
                  className={`block rounded border px-3 py-2 text-sm ${
                    conversation.id === selectedConversationId
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <span className="font-mono text-xs text-gray-500">{conversation.contactId}</span>
                  {conversation.status === 'needs_human' && (
                    <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      precisa humano
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600">Conversa</h2>
          {needsHuman && (
            <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
              Esta conversa precisa de um humano
            </span>
          )}
        </div>

        <div className="min-h-32 space-y-3 rounded border border-gray-200 bg-gray-50 p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-gray-500">
              Digite uma mensagem como se fosse o cliente no WhatsApp.
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'ml-auto bg-blue-600 text-white'
                    : 'mr-auto bg-white text-gray-800 shadow-sm'
                }`}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.role === 'assistant' && m.confidence != null && (
                  <p className="mt-1 text-xs opacity-70">confiança: {m.confidence.toFixed(2)}</p>
                )}
              </div>
            ))
          )}
        </div>

        {lastAssistant && lastAssistant.sources.length > 0 && (
          <div className="rounded border border-gray-200 bg-white p-3 text-xs text-gray-600">
            <p className="font-semibold">Fontes da última resposta:</p>
            <ul className="mt-1 list-disc pl-5">
              {lastAssistant.sources.map((source) => (
                <li key={source.fileName}>
                  {source.title} <span className="text-gray-400">({source.fileName})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Form method="post" className="space-y-2">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        {selectedConversationId && (
          <input type="hidden" name="conversationId" value={selectedConversationId} />
        )}
        <textarea
          name="message"
          required
          rows={3}
          placeholder="Mensagem do cliente..."
          className="w-full rounded border border-gray-300 p-2 text-sm"
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Enviar
        </button>
      </Form>
    </main>
  )
}
