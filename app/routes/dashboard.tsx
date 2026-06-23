import { Link } from 'react-router'
import { getDashboardData } from '../lib/dashboard.server'
import type { Route } from './+types/dashboard'

export async function loader() {
  return getDashboardData()
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Produto Hermes — Dashboard' },
    { name: 'description', content: 'Painel read-only do simulador (MVP simulado).' },
  ]
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  )
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { summary, conversations, leads } = loaderData

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Produto Hermes — Dashboard</h1>
        <p className="text-sm text-amber-700">MVP simulado — dados locais do SQLite.</p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Conversas" value={summary.totalConversations} />
        <Card label="Mensagens" value={summary.totalMessages} />
        <Card label="Leads" value={summary.totalLeads} />
        <Card label="Precisam humano" value={summary.needsHumanConversations} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-600">Conversas recentes</h2>
        {conversations.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma conversa ainda.</p>
        ) : (
          <ul className="space-y-2">
            {conversations.map((conversation) => (
              <li
                key={conversation.id}
                className="rounded border border-gray-200 bg-white p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{conversation.tenantName}</span>
                  <span className="font-mono text-xs text-gray-500">{conversation.contactId}</span>
                  {conversation.status === 'needs_human' ? (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      precisa humano
                    </span>
                  ) : (
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {conversation.status}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{conversation.messageCount} msg</span>
                </div>
                <p className="mt-1 text-gray-700">
                  {conversation.lastMessagePreview ?? <span className="text-gray-400">—</span>}
                </p>
                <Link
                  to={`/demo/chat?tenant=${conversation.tenantSlug}&conversationId=${conversation.id}`}
                  className="mt-1 inline-block text-xs font-semibold text-blue-600"
                >
                  Abrir no simulador
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-600">Leads recentes</h2>
        {leads.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum lead ainda. A extração entra na Task 12.</p>
        ) : (
          <ul className="space-y-2">
            {leads.map((lead) => (
              <li key={lead.id} className="rounded border border-gray-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{lead.name ?? 'Sem nome'}</span>
                  <span className="text-xs text-gray-500">{lead.tenantName}</span>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {lead.stage}
                  </span>
                </div>
                <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-600">
                  <div>Telefone: {lead.phone ?? '—'}</div>
                  <div>Bairro: {lead.neighborhood ?? '—'}</div>
                  <div>Necessidade: {lead.need ?? '—'}</div>
                  <div>Urgência: {lead.urgency ?? '—'}</div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
