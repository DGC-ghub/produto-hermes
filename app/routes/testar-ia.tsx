import { useEffect, useRef } from 'react'
import { Form, Link, redirect, useActionData, useNavigation } from 'react-router'
import { WingMark } from '../components/brand/BrandMark'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { db } from '../db.server'
import { resolveTenantConfig } from '../lib/attendant/tenant-config-db.server'
import { requireOperator } from '../lib/auth.server'
import { processIncomingMessage } from '../lib/conversation.server'
import { truncateDemoMessage } from '../lib/demo-visitor.server'
import { listKnowledgeDocs } from '../lib/knowledge-db.server'
import { cx } from '../lib/ui'
import type { Route } from './+types/testar-ia'

// Simulador INTERNO: o dono conversa com a própria IA sem apontar o WhatsApp da empresa
// para ela. É o passo que faltava entre "configurei" e "confio" — e o que torna o produto
// demonstrável na frente de um cliente. Roda o motor de verdade, no tenant de quem está
// logado; nada sai para o WhatsApp.
//
// Duas regras estruturais desta tela:
//  1. TENANT E IDENTIDADE SÓ DA SESSÃO. Nada de tenantSlug/contactId vindo do formulário —
//     seria a porta para ler a conversa de outra empresa colando um id.
//  2. SEM BASE, SEM IA. Responder "sobre a empresa" sem saber nada dela é alucinação com
//     o selo do produto. Sem conhecimento a tela orienta e o motor nem é chamado.

/**
 * Identidade interna de teste, derivada da CONTA autenticada. Estável (a mesma pessoa volta
 * para a própria conversa) e separada por conta — dois sócios do mesmo tenant não se
 * atropelam. Nunca vem do cliente. Pura.
 */
export function simulatorContactId(accountId: string): string {
  return `simulator:${accountId}`
}

/** Canal desta tela. O motor grava na Conversation e o trace sai separado do WhatsApp real. */
const CHANNEL = 'simulator' as const

const SEM_BASE =
  'Sua IA ainda não tem sobre o que falar. Adicione pelo menos um documento na base de conhecimento antes de testar.'
const FALHA_MOTOR = 'Não consegui gerar a resposta agora. Tente de novo em instantes.'

/** Há pelo menos um documento com conteúdo de verdade? (doc só com espaço não conta.) */
function hasUsableKnowledge(docs: { content: string }[]): boolean {
  return docs.some((doc) => doc.content.trim().length > 0)
}

/** O perfil da empresa saiu do default? Espelha o passo "perfil" do checklist de onboarding. */
function hasProfile(segment: string | undefined): boolean {
  const value = segment?.trim() ?? ''
  return value.length > 0 && value !== 'não informado'
}

/** Config do tenant sem explodir a tela: config inválida vira "perfil incompleto". */
async function loadSegment(tenantSlug: string): Promise<string | undefined> {
  try {
    const config = await resolveTenantConfig(tenantSlug)
    return config?.businessProfile.segment
  } catch {
    return undefined
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOperator(request)
  const contactId = simulatorContactId(operator.accountId)

  const [docs, segment] = await Promise.all([
    listKnowledgeDocs(operator.tenantSlug),
    loadSegment(operator.tenantSlug),
  ])
  const ready = hasUsableKnowledge(docs)
  const missing = [...(ready ? [] : ['knowledge']), ...(hasProfile(segment) ? [] : ['profile'])]

  // A conversa é resolvida pela IDENTIDADE, não por id vindo de fora: os três filtros
  // juntos (tenant da sessão + contato interno + canal) são o isolamento.
  const conversation = await db.conversation.findFirst({
    where: { tenantId: operator.tenantId, contactId, channel: CHANNEL },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  const rows = conversation
    ? await db.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, confidence: true },
      })
    : []

  return {
    ready,
    missing,
    conversationId: conversation?.id ?? null,
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      confidence: row.confidence,
    })),
    operator: { username: operator.username, tenantSlug: operator.tenantSlug },
  }
}

export async function action({ request }: Route.ActionArgs) {
  const operator = await requireOperator(request)
  const contactId = simulatorContactId(operator.accountId)

  // Revalidação no SERVIDOR: a interface já esconde o formulário sem base, mas quem
  // manda um POST direto não passa pela interface.
  const docs = await listKnowledgeDocs(operator.tenantSlug)
  if (!hasUsableKnowledge(docs)) {
    return { error: SEM_BASE, needsKnowledge: true }
  }

  const form = await request.formData()
  // Textão não melhora a resposta, só infla o custo do cérebro — mesmo teto da demo.
  const message = truncateDemoMessage(String(form.get('message') ?? ''))
  if (message.trim().length === 0) {
    return redirect('/testar-ia')
  }

  // O conversationId do formulário é um PALPITE do cliente: só vale se a conversa for
  // deste tenant, desta identidade interna e deste canal. Não sendo, seguimos sem id
  // (o motor resolve pela identidade) em vez de estourar na cara de quem está testando.
  const conversationIdRaw = form.get('conversationId')
  const ownConversationId = conversationIdRaw
    ? (
        await db.conversation.findFirst({
          where: {
            id: String(conversationIdRaw),
            tenantId: operator.tenantId,
            contactId,
            channel: CHANNEL,
          },
          select: { id: true },
        })
      )?.id
    : undefined

  try {
    await processIncomingMessage({
      tenantSlug: operator.tenantSlug,
      message,
      conversationId: ownConversationId,
      contactId,
      channel: CHANNEL,
      preview: true,
    })
    return redirect('/testar-ia')
  } catch (error) {
    // Técnico vai pro log do servidor; a tela recebe a frase que o dono entende.
    console.error('[testar-ia] falha ao processar mensagem', error)
    return { error: FALHA_MOTOR }
  }
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Hermes — Testar minha IA' },
    { name: 'description', content: 'Converse com a sua IA antes de ligá-la no WhatsApp.' },
  ]
}

function AiAvatar() {
  return (
    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-brand-deep">
      <WingMark accent className="size-3.5 text-white" />
    </span>
  )
}

/** O que fazer antes de poder testar — com o caminho a um clique. */
function Orientacao({ missing }: { missing: string[] }) {
  const semBase = missing.includes('knowledge')
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-brand-deep">
        <WingMark accent className="size-5 text-white" />
      </span>
      <p className="max-w-md text-sm text-ink-soft">
        {semBase
          ? 'Antes de testar, sua IA precisa saber sobre a empresa. Sem isso ela não teria como responder — e inventar resposta é o que a gente não faz.'
          : 'Falta pouco para o teste ficar completo.'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {semBase && (
          <Link
            to="/conhecimento"
            className="inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-deep"
          >
            Adicionar base de conhecimento
          </Link>
        )}
        {missing.includes('profile') && (
          <Link
            to="/configuracoes"
            className="inline-flex rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-bg"
          >
            Completar o perfil da empresa
          </Link>
        )}
      </div>
    </Card>
  )
}

/** Identidade do editor: muda só quando uma nova mensagem persistida volta do loader. */
export function simulatorComposerKey(messages: Array<{ id: string }>): string {
  return messages.at(-1)?.id ?? 'novo'
}

export default function TestarIa({ loaderData }: Route.ComponentProps) {
  const { ready, missing, messages, conversationId, operator } = loaderData
  const navigation = useNavigation()
  const actionData = useActionData<typeof action>()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Enquanto a action roda (~10-16s no motor atual), mostra a mensagem na hora e trava
  // os controles: dois cliques virariam duas rodadas do cérebro.
  const pendingValue = navigation.formData?.get('message')
  const pendingText =
    typeof pendingValue === 'string' && pendingValue.trim().length > 0 ? pendingValue : null
  const sending = navigation.state !== 'idle' && pendingText !== null
  const pendingMessage = navigation.state === 'submitting' ? pendingText : null
  // Remonta o formulário quando uma nova mensagem é persistida, limpando o textarea
  // não-controlado — sem isso o texto enviado fica preso no campo e convida a reenviar
  // (foi exatamente essa a causa da resposta duplicada na Central).
  const formKey = simulatorComposerKey(messages)

  useEffect(() => {
    if (!sending) {
      textareaRef.current?.focus()
    }
  }, [sending])

  return (
    <AppShell operator={operator}>
      <header className="border-b border-border bg-surface px-6 py-4">
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">Testar minha IA</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Escreva como se fosse um cliente e veja o que a sua IA responde. É um simulador: nada é
          enviado para o WhatsApp de ninguém.
        </p>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
        {!ready ? (
          <Orientacao missing={missing} />
        ) : (
          <>
            {missing.includes('profile') && (
              <p className="rounded-lg border border-waiting/30 bg-waiting/8 px-3 py-2 text-sm text-ink-soft">
                O perfil da empresa está incompleto — a IA responde, mas com menos contexto.{' '}
                <Link to="/configuracoes" className="font-medium text-ink underline">
                  Completar agora
                </Link>
              </p>
            )}

            <div className="min-h-44 space-y-3 rounded-card bg-bg-warm p-4">
              {messages.length === 0 && !sending ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <AiAvatar />
                  <p className="max-w-sm text-sm text-ink-soft">
                    Faça a pergunta que os seus clientes mais fazem.
                  </p>
                </div>
              ) : (
                <>
                  {messages.map((m) =>
                    m.role === 'user' ? (
                      <div
                        key={m.id}
                        className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white"
                      >
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </div>
                    ) : (
                      <div key={m.id} className="mr-auto flex max-w-[88%] items-start gap-2">
                        <AiAvatar />
                        <div className="rounded-2xl rounded-tl-sm border border-border bg-surface px-3 py-2 text-sm text-ink shadow-sm">
                          <p className="whitespace-pre-wrap">{m.content}</p>
                          {m.confidence != null && (
                            <p className="mt-1 text-[11px] text-ink-soft/70">
                              confiança {m.confidence.toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                    ),
                  )}

                  {pendingMessage && (
                    <>
                      <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white opacity-70">
                        <p className="whitespace-pre-wrap">{pendingMessage}</p>
                      </div>
                      <div className="mr-auto flex items-start gap-2">
                        <AiAvatar />
                        <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border bg-surface px-3 py-2 text-sm text-ink-soft shadow-sm">
                          <span className="inline-block size-1.5 animate-pulse rounded-full bg-brand" />
                          Hermes está pensando… costuma levar de 10 a 16 segundos.
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            {actionData?.error && (
              <div className="rounded-lg border border-urgent/30 bg-urgent/8 p-3 text-sm text-urgent">
                {actionData.error}
              </div>
            )}

            <Form
              key={formKey}
              method="post"
              className="space-y-2"
              onSubmit={(event) => {
                const value = String(new FormData(event.currentTarget).get('message') ?? '')
                if (value.trim().length === 0) {
                  event.preventDefault()
                }
              }}
            >
              {conversationId && (
                <input type="hidden" name="conversationId" value={conversationId} />
              )}
              <textarea
                ref={textareaRef}
                name="message"
                required
                rows={3}
                disabled={sending}
                placeholder="Ex.: vocês atendem no sábado?"
                className={cx(
                  'w-full rounded-lg border border-border bg-surface p-2.5 text-sm text-ink placeholder:text-ink-soft/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                  sending && 'opacity-60',
                )}
              />
              <Button type="submit" variant="primary" disabled={sending}>
                {sending ? 'Enviando…' : 'Enviar'}
              </Button>
            </Form>
          </>
        )}
      </div>
    </AppShell>
  )
}
