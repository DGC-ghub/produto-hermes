import { Form, Link, redirect, useActionData } from 'react-router'
import { db } from '../db.server'
import { requireOperator } from '../lib/auth.server'
import { isConversationAction, nextConversationStatus } from '../lib/conversation-status'
import {
  type ContactDossier,
  type DossierPriority,
  getContactDossier,
  getHandoffQueue,
} from '../lib/dossier.server'
import { generateConversationSummary } from '../lib/summary.server'
import { isTicketStatus } from '../lib/ticket'
import type { Route } from './+types/atendente'

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOperator(request)
  const url = new URL(request.url)
  const contactId = url.searchParams.get('contactId')

  // O tenant vem SEMPRE da sessão do operador — nunca da query —, então ninguém vê
  // dados de outra empresa trocando a URL. Um contactId de fora simplesmente não casa.
  const queue = await getHandoffQueue(operator.tenantId)
  const dossier = contactId ? await getContactDossier(operator.tenantSlug, contactId) : null

  return {
    queue,
    dossier,
    operator: { username: operator.username, tenantSlug: operator.tenantSlug },
    selected: { contactId },
  }
}

export async function action({ request }: Route.ActionArgs) {
  const operator = await requireOperator(request)
  const formData = await request.formData()
  const contactId = String(formData.get('contactId') ?? '')

  // Ação de RESUMO: gera/atualiza o resumo da conversa ativa do contato (IA + fallback).
  if (String(formData.get('intent') ?? '') === 'summary') {
    const conversation = await db.conversation.findFirst({
      where: { tenantId: operator.tenantId, contactId, status: { not: 'closed' } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })
    if (!conversation) {
      return { error: 'Conversa não encontrada.' }
    }
    await generateConversationSummary(conversation.id, operator.tenantId)
    return redirect(`/atendente?contactId=${contactId}`)
  }

  // Ação de CHAMADO: muda o status de um ticket (escopado pelo tenant do operador).
  const ticketId = String(formData.get('ticketId') ?? '')
  if (ticketId) {
    const ticketStatus = String(formData.get('ticketStatus') ?? '')
    if (!isTicketStatus(ticketStatus)) {
      return { error: 'Status de chamado inválido.' }
    }
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, tenantId: true },
    })
    if (!ticket || ticket.tenantId !== operator.tenantId) {
      return { error: 'Chamado não encontrado.' }
    }
    await db.ticket.update({ where: { id: ticketId }, data: { status: ticketStatus } })
    return redirect(`/atendente?contactId=${contactId}`)
  }

  // Ação de CONVERSA: assumir/devolver/encerrar.
  const actionName = String(formData.get('action') ?? '')
  if (!isConversationAction(actionName)) {
    return { error: 'Ação inválida.' }
  }
  // A conversa ativa do contato — SEMPRE escopada pelo tenant do operador, então
  // ninguém age sobre conversa de outra empresa.
  const conversation = await db.conversation.findFirst({
    where: { tenantId: operator.tenantId, contactId, status: { not: 'closed' } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true },
  })
  if (!conversation) {
    return { error: 'Conversa não encontrada.' }
  }
  const next = nextConversationStatus(conversation.status, actionName)
  if (!next) {
    return { error: 'Essa ação não é possível no estado atual da conversa.' }
  }
  await db.conversation.update({
    where: { id: conversation.id },
    data: { status: next, updatedAt: new Date() },
  })
  // Encerrou: volta pra fila. Assumiu/devolveu: continua na ficha do contato.
  return redirect(actionName === 'encerrar' ? '/atendente' : `/atendente?contactId=${contactId}`)
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Hermes — Atendente' },
    { name: 'description', content: 'Fila de atendimentos encaminhados e ficha do cliente.' },
  ]
}

const PRIORITY_LABEL: Record<DossierPriority, string> = {
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
}
const PRIORITY_CLASS: Record<DossierPriority, string> = {
  alta: 'bg-red-100 text-red-700',
  media: 'bg-amber-100 text-amber-700',
  baixa: 'bg-gray-100 text-gray-600',
}

// Traduz o motivo técnico do handoff para algo que o atendente lê de bate-pronto.
const REASON_LABEL: Record<string, string> = {
  requested_human: 'Cliente pediu atendimento humano',
  sensitive_topic: 'Tema sensível (contrato / jurídico / LGPD)',
  no_knowledge_match: 'Sem resposta na base de conhecimento',
  provider_error: 'Falha técnica na IA — revisar',
  validacao_falhou: 'Resposta da IA barrada pela validação — revisar',
}
function reasonLabel(reason: string | null): string {
  if (!reason) return '—'
  return REASON_LABEL[reason] ?? reason
}

function PriorityBadge({ priority }: { priority: DossierPriority }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${PRIORITY_CLASS[priority]}`}>
      {PRIORITY_LABEL[priority]}
    </span>
  )
}

function Dossier({ dossier }: { dossier: ContactDossier }) {
  const { lead, tickets } = dossier
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={dossier.priority} />
          {dossier.status === 'human' && (
            <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
              Em atendimento humano
            </span>
          )}
          <span className="text-xs text-gray-500">{dossier.tenantName}</span>
          <span className="font-mono text-xs text-gray-400">{dossier.contactId}</span>
        </div>
        <h2 className="text-lg font-bold">{dossier.headline}</h2>
        <p className="text-sm text-gray-600">
          Encaminhado porque:{' '}
          <span className="font-medium">{reasonLabel(dossier.handoffReason)}</span>
        </p>
      </div>

      <section className="rounded border border-amber-200 bg-amber-50 p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-600">Resumo da conversa</h3>
          <Form method="post">
            <input type="hidden" name="contactId" value={dossier.contactId} />
            <button
              type="submit"
              name="intent"
              value="summary"
              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600"
            >
              {dossier.summary ? 'Atualizar' : 'Gerar resumo'}
            </button>
          </Form>
        </div>
        {dossier.summary ? (
          <p className="whitespace-pre-wrap text-sm text-gray-700">{dossier.summary}</p>
        ) : (
          <p className="text-sm text-gray-400">
            Ainda não gerado — clique em "Gerar resumo" para a IA resumir a conversa.
          </p>
        )}
      </section>

      <section className="rounded border border-gray-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-gray-600">Ficha do cliente</h3>
        {lead ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-700">
            <div>Nome: {lead.name ?? '—'}</div>
            <div>Telefone: {lead.phone ?? '—'}</div>
            <div>Bairro: {lead.neighborhood ?? '—'}</div>
            <div>Urgência: {lead.urgency ?? '—'}</div>
            <div className="col-span-2">Necessidade: {lead.need ?? '—'}</div>
            <div>Estágio: {lead.stage}</div>
          </dl>
        ) : (
          <p className="text-sm text-gray-400">Sem ficha de lead ainda.</p>
        )}
      </section>

      <section className="rounded border border-gray-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-gray-600">
          Chamados ({dossier.openTicketCount} aberto{dossier.openTicketCount === 1 ? '' : 's'})
        </h3>
        {tickets.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum chamado registrado.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    ticket.status === 'resolvido'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {ticket.status}
                </span>
                <span className="flex-1 text-gray-700">{ticket.subject}</span>
                <Form method="post">
                  <input type="hidden" name="contactId" value={dossier.contactId} />
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  {ticket.status === 'resolvido' ? (
                    <button
                      type="submit"
                      name="ticketStatus"
                      value="aberto"
                      className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600"
                    >
                      Reabrir
                    </button>
                  ) : (
                    <button
                      type="submit"
                      name="ticketStatus"
                      value="resolvido"
                      className="rounded border border-green-300 px-2 py-0.5 text-xs text-green-700"
                    >
                      Resolver
                    </button>
                  )}
                </Form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-gray-200 bg-gray-50 p-3">
        <h3 className="mb-2 text-sm font-semibold text-gray-600">Conversa recente</h3>
        <div className="space-y-2">
          {dossier.recentMessages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${
                message.role === 'user'
                  ? 'ml-auto bg-blue-600 text-white'
                  : 'mr-auto bg-white text-gray-800 shadow-sm'
              }`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
        {dossier.status === 'human' ? (
          <Form method="post">
            <input type="hidden" name="contactId" value={dossier.contactId} />
            <button
              type="submit"
              name="action"
              value="devolver"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Devolver ao Hermes
            </button>
          </Form>
        ) : (
          <Form method="post">
            <input type="hidden" name="contactId" value={dossier.contactId} />
            <button
              type="submit"
              name="action"
              value="assumir"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Assumir atendimento
            </button>
          </Form>
        )}
        <Form method="post">
          <input type="hidden" name="contactId" value={dossier.contactId} />
          <button
            type="submit"
            name="action"
            value="encerrar"
            className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
          >
            Encerrar
          </button>
        </Form>
        <Link
          to={`/demo/chat?tenant=${dossier.tenantSlug}&contactId=${dossier.contactId}`}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
        >
          Abrir no simulador
        </Link>
      </div>
    </div>
  )
}

export default function Atendente({ loaderData }: Route.ComponentProps) {
  const { queue, dossier, operator, selected } = loaderData
  const actionData = useActionData<typeof action>()

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      {actionData?.error && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {actionData.error}
        </div>
      )}
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Hermes — Atendente</h1>
          <p className="text-sm text-gray-500">
            Fila de atendimentos que o Hermes encaminhou. Clique para ver a ficha do cliente.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {operator.username} · <span className="font-medium">{operator.tenantSlug}</span>
          </span>
          <Form method="post" action="/logout">
            <button
              type="submit"
              className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600"
            >
              Sair
            </button>
          </Form>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        <aside className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-600">Fila ({queue.length})</h2>
          {queue.length === 0 ? (
            <p className="text-sm text-gray-500">Ninguém na fila. 🎉</p>
          ) : (
            <ul className="space-y-2">
              {queue.map((item) => {
                const isActive = selected.contactId === item.contactId
                return (
                  <li key={item.conversationId}>
                    <Link
                      to={`/atendente?contactId=${item.contactId}`}
                      className={`block rounded border p-2 text-sm ${
                        isActive ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <PriorityBadge priority={item.priority} />
                        {item.status === 'human' && (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
                            assumida
                          </span>
                        )}
                        <span className="text-xs text-gray-500">{item.tenantName}</span>
                      </div>
                      <p className="font-medium text-gray-800">{item.headline}</p>
                      <p className="text-xs text-gray-500">{reasonLabel(item.handoffReason)}</p>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        <section className="rounded border border-gray-200 bg-gray-50 p-4">
          {dossier ? (
            <Dossier dossier={dossier} />
          ) : (
            <p className="text-sm text-gray-500">
              {queue.length === 0
                ? 'Sem atendimentos encaminhados no momento.'
                : 'Selecione um atendimento na fila para ver a ficha do cliente.'}
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
