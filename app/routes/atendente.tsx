import type { ReactNode } from 'react'
import { Form, Link, redirect, useActionData } from 'react-router'
import { WingMark } from '../components/brand/BrandMark'
import { EmptyState } from '../components/EmptyState'
import { AppShell } from '../components/layout/AppShell'
import { OnboardingChecklist } from '../components/OnboardingChecklist'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Tag } from '../components/ui/Tag'
import { db } from '../db.server'
import { requireOperator } from '../lib/auth.server'
import { isConversationAction, nextConversationStatus } from '../lib/conversation-status'
import {
  type ContactDossier,
  type DossierPriority,
  getContactDossier,
  getHandoffQueue,
} from '../lib/dossier.server'
import { getOnboardingStatus } from '../lib/onboarding.server'
import { sendOperatorReply } from '../lib/operator-reply.server'
import { generateConversationSummary } from '../lib/summary.server'
import { isTicketStatus } from '../lib/ticket'
import { cx } from '../lib/ui'
import type { Route } from './+types/atendente'

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOperator(request)
  const url = new URL(request.url)
  const contactId = url.searchParams.get('contactId')

  // O tenant vem SEMPRE da sessão do operador — nunca da query —, então ninguém vê
  // dados de outra empresa trocando a URL. Um contactId de fora simplesmente não casa.
  const queue = await getHandoffQueue(operator.tenantId)
  const dossier = contactId ? await getContactDossier(operator.tenantSlug, contactId) : null
  const onboarding = await getOnboardingStatus(operator.tenantSlug)

  return {
    queue,
    dossier,
    onboarding,
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

  // Ação de RESPOSTA: o operador responde o cliente pelo WhatsApp direto da Central.
  if (String(formData.get('intent') ?? '') === 'reply') {
    const result = await sendOperatorReply({
      tenantId: operator.tenantId,
      tenantSlug: operator.tenantSlug,
      contactId,
      text: String(formData.get('text') ?? ''),
    })
    if (!result.ok) {
      return { error: result.error }
    }
    return redirect(`/atendente?contactId=${contactId}`)
  }

  // Ação de CHAMADO: muda o status de um ticket (escopado pelo tenant do operador).
  const ticketId = String(formData.get('ticketId') ?? '')
  if (ticketId) {
    const ticketStatus = String(formData.get('ticketStatus') ?? '')
    if (!isTicketStatus(ticketStatus)) {
      return { error: 'Status de chamado inválido.' }
    }
    // Escopa por tenant no PRÓPRIO filtro (não "lê e depois compara"): um chamado de
    // outra empresa simplesmente não casa, então nunca é lido antes da checagem.
    const ticket = await db.ticket.findFirst({
      where: { id: ticketId, tenantId: operator.tenantId },
      select: { id: true },
    })
    if (!ticket) {
      return { error: 'Chamado não encontrado.' }
    }
    await db.ticket.update({ where: { id: ticket.id }, data: { status: ticketStatus } })
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

// Traduz o motivo técnico do handoff para algo que o atendente lê de bate-pronto.
const REASON_LABEL: Record<string, string> = {
  requested_human: 'Cliente pediu atendimento humano',
  sensitive_topic: 'Tema sensível (contrato / jurídico / LGPD)',
  no_knowledge_match: 'Sem resposta na base de conhecimento',
  provider_error: 'Falha técnica na IA — revisar',
  validacao_falhou: 'Resposta da IA barrada pela validação — revisar',
  billing_inactive: 'Assinatura inativa — responda ou regularize o pagamento',
}
function reasonLabel(reason: string | null): string {
  if (!reason) {
    return '—'
  }
  return REASON_LABEL[reason] ?? reason
}

const PRIORITY: Record<DossierPriority, { label: string; dot: string; text: string }> = {
  alta: { label: 'alta', dot: 'bg-urgent', text: 'text-urgent' },
  media: { label: 'média', dot: 'bg-waiting', text: 'text-waiting' },
  baixa: { label: 'baixa', dot: 'bg-ink-soft', text: 'text-ink-soft' },
}

function PriorityTag({ priority }: { priority: DossierPriority }) {
  const meta = PRIORITY[priority]
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs', meta.text)}>
      <span className={cx('size-1.5 rounded-full', meta.dot)} />
      prioridade {meta.label}
    </span>
  )
}

/** Form de uma linha que dispara uma ação de conversa (assumir/devolver/encerrar). */
function ConversationAction({
  contactId,
  action,
  variant,
  children,
}: {
  contactId: string
  action: string
  variant?: 'primary' | 'secondary' | 'ghost'
  children: ReactNode
}) {
  return (
    <Form method="post">
      <input type="hidden" name="contactId" value={contactId} />
      <Button type="submit" name="action" value={action} variant={variant}>
        {children}
      </Button>
    </Form>
  )
}

function Dossier({ dossier }: { dossier: ContactDossier }) {
  const { lead, tickets } = dossier
  const assumed = dossier.status === 'human'

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Avatar name={dossier.headline} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            {dossier.headline}
          </h2>
          <p className="text-xs text-ink-soft">
            {dossier.tenantName} · <span className="font-mono">{dossier.contactId}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PriorityTag priority={dossier.priority} />
            {assumed && <Tag>em atendimento humano</Tag>}
          </div>
        </div>
        <div className="shrink-0">
          {assumed ? (
            <ConversationAction contactId={dossier.contactId} action="devolver">
              Devolver ao Hermes
            </ConversationAction>
          ) : (
            <ConversationAction contactId={dossier.contactId} action="assumir" variant="primary">
              Assumir conversa
            </ConversationAction>
          )}
        </div>
      </div>

      <p className="text-sm text-ink-soft">
        Encaminhado: <span className="text-ink">{reasonLabel(dossier.handoffReason)}</span>
      </p>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand">
            <WingMark accent className="size-4" />
            Resumo do Hermes
          </span>
          <Form method="post">
            <input type="hidden" name="contactId" value={dossier.contactId} />
            <Button type="submit" name="intent" value="summary" size="sm">
              {dossier.summary ? 'Atualizar' : 'Gerar'}
            </Button>
          </Form>
        </div>
        {dossier.summary ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
            {dossier.summary}
          </p>
        ) : (
          <p className="text-sm text-ink-soft/70">
            Ainda não gerado — clique em "Gerar" para a IA resumir a conversa.
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-medium text-ink">Ficha do cliente</h3>
        {lead ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-ink-soft">
            <div>
              Nome: <span className="text-ink">{lead.name ?? '—'}</span>
            </div>
            <div>
              Telefone: <span className="text-ink">{lead.phone ?? '—'}</span>
            </div>
            <div>
              Bairro: <span className="text-ink">{lead.neighborhood ?? '—'}</span>
            </div>
            <div>
              Urgência: <span className="text-ink">{lead.urgency ?? '—'}</span>
            </div>
            <div className="col-span-2">
              Necessidade: <span className="text-ink">{lead.need ?? '—'}</span>
            </div>
            <div>
              Estágio: <span className="text-ink">{lead.stage}</span>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-ink-soft/70">Sem ficha de lead ainda.</p>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-medium text-ink">
          Chamados ({dossier.openTicketCount} aberto{dossier.openTicketCount === 1 ? '' : 's'})
        </h3>
        {tickets.length === 0 ? (
          <p className="text-sm text-ink-soft/70">Nenhum chamado registrado.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {tickets.map((ticket) => {
              const resolved = ticket.status === 'resolvido'
              return (
                <li key={ticket.id} className="flex items-center gap-2">
                  <span
                    className={cx(
                      'inline-flex items-center gap-1.5 text-xs',
                      resolved ? 'text-brand' : 'text-ink-soft',
                    )}
                  >
                    <span
                      className={cx('size-1.5 rounded-full', resolved ? 'bg-brand' : 'bg-ai')}
                    />
                    {ticket.status}
                  </span>
                  <span className="flex-1 text-ink">{ticket.subject}</span>
                  <Form method="post">
                    <input type="hidden" name="contactId" value={dossier.contactId} />
                    <input type="hidden" name="ticketId" value={ticket.id} />
                    <Button
                      type="submit"
                      name="ticketStatus"
                      value={resolved ? 'aberto' : 'resolvido'}
                      size="sm"
                    >
                      {resolved ? 'Reabrir' : 'Resolver'}
                    </Button>
                  </Form>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-medium text-ink">Conversa recente</h3>
        <div className="space-y-2">
          {dossier.recentMessages.map((message) => {
            const fromClient = message.role === 'user'
            return (
              <div
                key={message.id}
                className={cx(
                  'max-w-[80%] rounded-xl px-3 py-2 text-sm leading-snug',
                  fromClient
                    ? 'mr-auto rounded-tl-sm border border-border bg-surface text-ink'
                    : 'ml-auto rounded-tr-sm bg-brand text-white',
                )}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            )
          })}
        </div>
      </div>

      <Form method="post" className="border-t border-border pt-4">
        <input type="hidden" name="intent" value="reply" />
        <input type="hidden" name="contactId" value={dossier.contactId} />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Responder o cliente</span>
          <textarea
            name="text"
            rows={2}
            required
            placeholder="Escreva a resposta que vai pelo WhatsApp…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
          />
        </label>
        <div className="mt-2">
          <Button type="submit" variant="primary" size="sm">
            Enviar resposta
          </Button>
        </div>
      </Form>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <ConversationAction contactId={dossier.contactId} action="encerrar">
          Encerrar
        </ConversationAction>
        <Link
          to={`/demo/chat?tenant=${dossier.tenantSlug}&contactId=${dossier.contactId}`}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-bg"
        >
          Abrir no simulador
        </Link>
      </div>
    </div>
  )
}

export default function Atendente({ loaderData }: Route.ComponentProps) {
  const { queue, dossier, onboarding, operator, selected } = loaderData
  const actionData = useActionData<typeof action>()
  const needsCount = queue.filter((item) => item.status === 'needs_human').length

  return (
    <AppShell operator={operator}>
      <header className="flex items-center gap-3 border-b border-border bg-surface px-6 py-4">
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">
          Central do atendente
        </h1>
        {needsCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-ink-soft">
            <span className="size-1.5 rounded-full bg-urgent" />
            {needsCount} precisam de você
          </span>
        )}
      </header>

      <div className="p-6">
        {!onboarding.allDone && <OnboardingChecklist status={onboarding} />}
        {actionData?.error && (
          <div className="mb-4 rounded-lg border border-urgent/30 bg-urgent/10 px-3 py-2 text-sm text-urgent">
            {actionData.error}
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-[300px_1fr]">
          <aside>
            <h2 className="mb-3 text-sm font-medium text-ink">Fila ({queue.length})</h2>
            {queue.length === 0 ? (
              <EmptyState image="/brand/empty-caught-up.svg">
                Ninguém na fila. Tudo em dia.
              </EmptyState>
            ) : (
              <ul className="space-y-2">
                {queue.map((item) => {
                  const isActive = selected.contactId === item.contactId
                  return (
                    <li key={item.conversationId}>
                      <Link
                        to={`/atendente?contactId=${item.contactId}`}
                        className={cx(
                          'block rounded-xl border p-3 transition-colors',
                          isActive
                            ? 'border-brand bg-brand/5'
                            : 'border-border bg-surface hover:bg-bg',
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <Avatar name={item.headline} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">{item.headline}</p>
                            <p className="truncate text-xs text-ink-soft">
                              {reasonLabel(item.handoffReason)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft">
                          <span
                            className={cx('size-1.5 rounded-full', PRIORITY[item.priority].dot)}
                          />
                          {item.status === 'human' ? 'em atendimento' : 'precisa de você'}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>

          <section>
            {dossier ? (
              <Dossier dossier={dossier} />
            ) : (
              <EmptyState image="/brand/empty-no-conversations.svg">
                {queue.length === 0
                  ? 'Sem atendimentos encaminhados no momento.'
                  : 'Selecione um atendimento na fila para ver a ficha do cliente.'}
              </EmptyState>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  )
}
