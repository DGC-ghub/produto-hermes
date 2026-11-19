import { Form, Link, redirect } from 'react-router'
import { db } from '../db.server'
import { processIncomingMessage } from '../lib/conversation.server'
import { iniciarCobranca } from '../lib/nota/fluxo'
import {
  criarDeps,
  emissorEmModoFalso,
  type ResultadoSimulado,
  SemCobrancaError,
  simularPagamentoENota,
  temCobrancaAguardando,
} from '../lib/nota/nota.server'
import { SERVICO_PADRAO } from '../lib/nota/servicos'
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
  const aviso = url.searchParams.get('aviso')

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
    modoFalso: emissorEmModoFalso(),
    aviso: aviso ? aviso.slice(0, 200) : null,
    cobrancaAguardando: selected ? await temCobrancaAguardando(selected.id) : false,
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
  const intent = String(formData.get('intent') ?? 'mensagem')

  // M7 (teste): fim do atendimento gera Pix de teste; no modo falso, simula pagamento e nota.
  if (intent === 'cobrar' || intent === 'simular') {
    const id = conversationIdRaw ? String(conversationIdRaw) : ''
    const conversa = id ? await db.conversation.findUnique({ where: { id } }) : null
    if (!conversa) {
      return redirect(`/demo/chat?tenant=${tenantSlug}`)
    }
    const voltar = (aviso?: string) =>
      redirect(
        `/demo/chat?tenant=${tenantSlug}&conversationId=${id}${
          aviso ? `&aviso=${encodeURIComponent(aviso)}` : ''
        }`,
      )
    try {
      if (intent === 'cobrar') {
        const reais = Number(String(formData.get('valor') ?? '').replace(',', '.'))
        const centavos = Math.round(reais * 100)
        if (!Number.isFinite(centavos) || centavos <= 0) {
          return voltar('Valor inválido. Digite um valor maior que zero, como 150,00.')
        }
        await iniciarCobranca(
          { conversationId: id, servicoChave: SERVICO_PADRAO, valorCentavos: centavos },
          criarDeps(),
        )
      } else {
        const r = String(formData.get('resultado'))
        const permitido: ResultadoSimulado[] = ['autorizada', 'rejeitada', 'rejeitada_sem_motivo']
        if (permitido.includes(r as ResultadoSimulado)) {
          await simularPagamentoENota(id, r as ResultadoSimulado)
        }
      }
    } catch (erro) {
      if (erro instanceof SemCobrancaError) {
        return voltar('Gere o Pix de teste primeiro. Não há cobrança aguardando pagamento.')
      }
      console.warn('[nota] falha na demo', erro instanceof Error ? erro.message : erro)
      return voltar('Não consegui concluir. Tente de novo.')
    }
    return voltar()
  }

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
  const {
    tenantSlug,
    tenants,
    conversations,
    modoFalso,
    aviso,
    cobrancaAguardando,
    selectedConversationId,
    selectedStatus,
    messages,
  } = loaderData
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

      {selectedConversationId && (
        <section className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
          <h2 className="text-sm font-semibold text-amber-800">
            Nota fiscal (TESTE, sem valor fiscal)
          </h2>
          <Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="conversationId" value={selectedConversationId} />
            <input type="hidden" name="intent" value="cobrar" />
            <input
              name="valor"
              defaultValue="150,00"
              className="w-24 rounded border border-gray-300 p-1 text-sm"
              aria-label="Valor em reais"
            />
            <button type="submit" className="rounded bg-amber-600 px-3 py-1 text-sm text-white">
              Encerrar atendimento e gerar Pix de teste
            </button>
          </Form>
          {aviso && (
            <p role="alert" className="text-sm text-red-700">
              {aviso}
            </p>
          )}
          {modoFalso && cobrancaAguardando && (
            <Form method="post" className="flex flex-wrap items-center gap-2 text-sm">
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="conversationId" value={selectedConversationId} />
              <input type="hidden" name="intent" value="simular" />
              <span className="text-gray-600">
                Sem chave: simular pagamento e resposta da prefeitura:
              </span>
              <button
                type="submit"
                name="resultado"
                value="autorizada"
                className="rounded border px-2 py-1"
              >
                Nota autorizada
              </button>
              <button
                type="submit"
                name="resultado"
                value="rejeitada"
                className="rounded border px-2 py-1"
              >
                Nota rejeitada
              </button>
              <button
                type="submit"
                name="resultado"
                value="rejeitada_sem_motivo"
                className="rounded border px-2 py-1"
              >
                Rejeitada sem motivo
              </button>
            </Form>
          )}
        </section>
      )}
    </main>
  )
}
