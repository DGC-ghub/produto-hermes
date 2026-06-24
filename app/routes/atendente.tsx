import { Form, Link } from 'react-router'
import { requireOperator } from '../lib/auth.server'
import {
  type ContactDossier,
  type DossierPriority,
  getContactDossier,
  getHandoffQueue,
} from '../lib/dossier.server'
import type { Route } from './+types/atendente'

export async function loader({ request }: Route.LoaderArgs) {
  await requireOperator(request)
  const url = new URL(request.url)
  const tenant = url.searchParams.get('tenant')
  const contactId = url.searchParams.get('contactId')

  const queue = await getHandoffQueue()
  const dossier = tenant && contactId ? await getContactDossier(tenant, contactId) : null

  return { queue, dossier, selected: { tenant, contactId } }
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
          <span className="text-xs text-gray-500">{dossier.tenantName}</span>
          <span className="font-mono text-xs text-gray-400">{dossier.contactId}</span>
        </div>
        <h2 className="text-lg font-bold">{dossier.headline}</h2>
        <p className="text-sm text-gray-600">
          Encaminhado porque:{' '}
          <span className="font-medium">{reasonLabel(dossier.handoffReason)}</span>
        </p>
      </div>

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
              <li key={`${ticket.subject}-${ticket.createdAt}`} className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    ticket.status === 'resolvido'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {ticket.status}
                </span>
                <span className="text-gray-700">{ticket.subject}</span>
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

      <Link
        to={`/demo/chat?tenant=${dossier.tenantSlug}&contactId=${dossier.contactId}`}
        className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
      >
        Assumir conversa no simulador
      </Link>
    </div>
  )
}

export default function Atendente({ loaderData }: Route.ComponentProps) {
  const { queue, dossier, selected } = loaderData

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Hermes — Atendente</h1>
          <p className="text-sm text-gray-500">
            Fila de atendimentos que o Hermes encaminhou. Clique para ver a ficha do cliente.
          </p>
        </div>
        <Form method="post" action="/logout">
          <button
            type="submit"
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600"
          >
            Sair
          </button>
        </Form>
      </header>

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        <aside className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-600">Fila ({queue.length})</h2>
          {queue.length === 0 ? (
            <p className="text-sm text-gray-500">Ninguém na fila. 🎉</p>
          ) : (
            <ul className="space-y-2">
              {queue.map((item) => {
                const isActive =
                  selected.tenant === item.tenantSlug && selected.contactId === item.contactId
                return (
                  <li key={item.conversationId}>
                    <Link
                      to={`/atendente?tenant=${item.tenantSlug}&contactId=${item.contactId}`}
                      className={`block rounded border p-2 text-sm ${
                        isActive ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <PriorityBadge priority={item.priority} />
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
