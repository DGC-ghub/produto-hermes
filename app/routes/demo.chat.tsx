import { useEffect, useRef, useState } from 'react'
import { data, Form, Link, redirect, useActionData, useNavigation } from 'react-router'
import { AudioRecorder } from '../components/audio-recorder'
import { WingMark } from '../components/brand/BrandMark'
import { PublicHeader } from '../components/layout/PublicHeader'
import { Button } from '../components/ui/Button'
import { db } from '../db.server'
import { transcribeUploadedAudio } from '../lib/audio/upload.server'
import { processIncomingMessage } from '../lib/conversation.server'
import {
  checkVisitorQuota,
  DEMO_MAX_PER_VISITOR,
  demoContactId,
  readDemoVisitor,
  truncateDemoMessage,
} from '../lib/demo-visitor.server'
import { checkRate, type RateState, rateConfig } from '../lib/rate-limit'
import { DEMO_TENANT_SLUGS, ensureInitialTenants, INITIAL_TENANTS } from '../lib/tenants.server'
import { cx } from '../lib/ui'
import type { Route } from './+types/demo.chat'

// Só tenants de DEMONSTRAÇÃO nesta rota pública: cliente real nunca aparece aqui
// (nem leitura da base dele, nem escrita anônima no banco de produção dele).
const DEMO_TENANTS = INITIAL_TENANTS.filter((tenant) => DEMO_TENANT_SLUGS.includes(tenant.slug))
const ALLOWED_SLUGS: readonly string[] = DEMO_TENANTS.map((tenant) => tenant.slug)
const DEFAULT_SLUG = 'dgc'

// Fusível GLOBAL da máquina: cada envio spawna o cérebro (~15-30s) e/ou a transcrição
// local (whisper, CPU-intensiva no Pi). O teto que importa é o POR VISITANTE (cookie,
// em demo-visitor.server); este aqui só evita que muita gente ao mesmo tempo derrube o
// Pi. Zera a cada reinício do serviço.
const DEMO_MAX_PER_WINDOW = 60
let demoRateState: RateState = { windowStart: 0, count: 0 }
// Orçamento por visitante (chave = id do cookie). Vive no processo, como os outros tetos.
const visitorRates = new Map<string, RateState>()

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

  // Identidade anônima do visitante: é o que escopa TUDO nesta tela.
  const visitor = await readDemoVisitor(request)
  const contactId = demoContactId(visitor.visitorId)

  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } })

  // Sempre a conversa DO VISITANTE: o filtro por contactId é o que impede abrir a
  // conversa alheia colando um conversationId na URL. Sem id na URL, retomamos a
  // conversa mais recente dele neste tenant (é o que ele espera ao voltar).
  const selected = tenant
    ? await db.conversation.findFirst({
        where: {
          tenantId: tenant.id,
          contactId,
          ...(conversationId ? { id: conversationId } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })
    : null

  const messages = selected
    ? await db.message.findMany({
        where: { conversationId: selected.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, confidence: true, sourcesJson: true },
      })
    : []

  return data(
    {
      tenantSlug,
      tenants: DEMO_TENANTS.map((t) => ({ slug: t.slug, name: t.name })),
      selectedConversationId: selected?.id ?? null,
      // Do parâmetro da última resposta, não do status: ver o comentário na action.
      needsHuman: url.searchParams.get('humano') === '1',
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        confidence: m.confidence,
        sources: parseSources(m.sourcesJson),
      })),
    },
    visitor.setCookie ? { headers: { 'Set-Cookie': visitor.setCookie } } : undefined,
  )
}

// Teto do corpo da requisição: rejeita uploads grandes ANTES de bufferizar o
// arquivo em memória (request.formData() carrega tudo na RAM). Content-Length é
// do cliente (pode ser forjado), então é só a 1ª linha — em produção, um proxy
// na borda (ex.: nginx client_max_body_size) é a defesa real contra OOM.
const MAX_BODY_BYTES = Number(process.env.MAX_AUDIO_BYTES ?? 15_000_000) + 1_000_000

export async function action({ request }: Route.ActionArgs) {
  const now = Date.now()
  const visitor = await readDemoVisitor(request)
  const contactId = demoContactId(visitor.visitorId)
  // Toda resposta leva o cookie quando a identidade acabou de nascer (ex.: primeiro
  // envio vindo de um POST direto, sem ter passado pelo loader).
  const headers = visitor.setCookie ? { 'Set-Cookie': visitor.setCookie } : undefined
  const fail = (error: string, limitReached = false) => data({ error, limitReached }, { headers })

  // Anti-abuso, camada 1 (fusível da máquina): rejeita o excesso ANTES de tocar IA/whisper.
  const rate = checkRate(now, demoRateState, DEMO_MAX_PER_WINDOW, rateConfig().windowMs)
  demoRateState = rate.state
  if (!rate.allowed) {
    return fail(`Muitas mensagens na demo agora. Tente de novo em ${rate.retryAfterSec}s.`)
  }

  // Camada 2 (a que importa): orçamento deste visitante. Estourou → vira convite.
  const quota = checkVisitorQuota(now, visitorRates, visitor.visitorId)
  if (!quota.allowed) {
    return fail(
      `Você já enviou ${DEMO_MAX_PER_VISITOR} mensagens na demonstração — é o limite por hora.`,
      true,
    )
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return fail('Áudio grande demais. Grave/escolha um áudio mais curto.')
  }

  const formData = await request.formData()
  const tenantSlug = resolveTenantSlug(String(formData.get('tenantSlug') ?? ''))
  const conversationIdRaw = formData.get('conversationId')

  // A conversa informada só vale se for DESTE visitante — o id do formulário é um
  // palpite do cliente. Não sendo dele, seguimos sem id (o motor resolve pelo contato).
  const ownConversationId = conversationIdRaw
    ? (
        await db.conversation.findFirst({
          where: { id: String(conversationIdRaw), contactId, tenant: { slug: tenantSlug } },
          select: { id: true },
        })
      )?.id
    : undefined

  // Áudio (gravação ou upload) converge no mesmo fluxo: transcreve para texto e
  // segue como se o cliente tivesse digitado. O texto vira a mensagem do cliente.
  const audio = formData.get('audio')
  let message: string
  if (audio instanceof File && audio.size > 0) {
    try {
      message = await transcribeUploadedAudio(audio)
    } catch (error) {
      console.error('[demo.chat] erro ao transcrever áudio', error)
      return fail('Não consegui entender o áudio. Tente gravar de novo ou digite a mensagem.')
    }
    if (message.trim().length === 0) {
      return fail('O áudio veio sem fala reconhecível. Tente de novo, falando mais perto.')
    }
  } else {
    message = String(formData.get('message') ?? '')
  }
  // Textão não melhora a resposta, só infla o custo do cérebro: corta no teto.
  message = truncateDemoMessage(message)

  // Mensagem vazia: volta sem processar (o textarea já tem `required`, isto é só defesa).
  if (message.trim().length === 0) {
    const back = ownConversationId ? `&conversationId=${ownConversationId}` : ''
    return redirect(`/demo/chat?tenant=${tenantSlug}${back}`, { headers })
  }

  try {
    const result = await processIncomingMessage({
      tenantSlug,
      message,
      conversationId: ownConversationId,
      contactId,
      // Visitante anônimo: nada de lead, chamado, handoff ou alarme (§7.3). Antes o modo era
      // omitido e o motor caía no default de efeitos LIGADOS — a Central recebia visitante.
      mode: 'public_demo',
    })
    // §7.3: o aviso vem do RETORNO do motor, não do status persistido. A demo não escala
    // conversa (`public_demo` não tem efeitos operacionais — a Central do cliente não recebe
    // visitante anônimo), então `status` fica `open` e ler dali apagaria o aviso em silêncio.
    // Vai na URL porque a action redireciona: é o único canal que sobrevive ao redirect.
    const avisoHumano = result.needsHuman ? '&humano=1' : ''
    return redirect(
      `/demo/chat?tenant=${result.tenantSlug}&conversationId=${result.conversationId}${avisoHumano}`,
      { headers },
    )
  } catch (error) {
    console.error('[demo.chat] erro ao processar mensagem', error)
    return fail('Não consegui processar a mensagem agora. Tente de novo em instantes.')
  }
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Hermes — demonstração' },
    { name: 'description', content: 'Converse com o Hermes como se fosse um cliente no WhatsApp.' },
  ]
}

// Avatar da IA: a asa do mensageiro num squircle verde. É a assinatura do Hermes
// "falando" nas bolhas.
function AiAvatar() {
  return (
    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-brand-deep">
      <WingMark accent className="size-3.5 text-white" />
    </span>
  )
}

export default function DemoChat({ loaderData }: Route.ComponentProps) {
  const { tenantSlug, tenants, selectedConversationId, needsHuman, messages } = loaderData
  const navigation = useNavigation()
  const actionData = useActionData<typeof action>()
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Áudio: gravador/upload avisam via setAudioSending; o indicador some ao voltar a idle.
  const [audioSending, setAudioSending] = useState(false)
  // Rastreia se há texto não enviado no textarea (não-controlado): bloqueia o áudio
  // enquanto houver, pra não descartar o texto silenciosamente quando o áudio vence.
  const [hasDraft, setHasDraft] = useState(false)
  useEffect(() => {
    if (navigation.state === 'idle') {
      setAudioSending(false)
      setHasDraft(false)
    }
  }, [navigation.state])

  // Feedback de envio (optimistic UI): enquanto a action roda (~13s), mostra a mensagem
  // do cliente na hora + "digitando", e trava os controles para não duplicar o envio.
  const pendingValue = navigation.formData?.get('message')
  const pendingText =
    typeof pendingValue === 'string' && pendingValue.trim().length > 0 ? pendingValue : null
  // Trava textarea/botão durante todo o round-trip (texto OU áudio).
  const sending = (navigation.state !== 'idle' && pendingText !== null) || audioSending
  // A bolha otimista + "digitando" aparece só na fase de submit: durante a revalidação
  // a mensagem já volta persistida do loader, então não piscamos uma cópia duplicada.
  const pendingMessage = navigation.state === 'submitting' ? pendingText : null
  // Remonta o formulário quando uma nova mensagem é persistida, limpando o textarea
  // não-controlado — senão o texto enviado fica preso no campo e convida a reenviar.
  const formKey = messages.at(-1)?.id ?? 'novo'
  // Áudio fica indisponível durante um envio OU quando há texto não enviado.
  const audioDisabled = sending || hasDraft

  // Devolve o foco ao campo ao fim do envio (o disabled remove o foco) — fluxo contínuo.
  useEffect(() => {
    if (!sending) {
      textareaRef.current?.focus()
    }
  }, [sending])

  return (
    <div className="min-h-screen bg-bg text-ink">
      <PublicHeader />

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <header>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Demonstração</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Você é o cliente: escreva como se fosse no WhatsApp. Ambiente de teste — sem WhatsApp
            real ainda.
          </p>
        </header>

        <section>
          <h2 className="mb-2 text-sm font-medium text-ink-soft">Empresa</h2>
          <div className="flex flex-wrap gap-2">
            {tenants.map((tenant) => (
              <Link
                key={tenant.slug}
                to={`/demo/chat?tenant=${tenant.slug}`}
                className={cx(
                  'rounded-full px-3 py-1.5 text-sm transition-colors',
                  tenant.slug === tenantSlug
                    ? 'bg-brand text-white'
                    : 'border border-border bg-surface text-ink-soft hover:text-ink',
                )}
              >
                {tenant.name}
              </Link>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-soft">Conversa</h2>
            {needsHuman && (
              <span className="inline-flex items-center gap-1.5 text-xs text-urgent">
                <span className="size-1.5 rounded-full bg-urgent" />
                precisa de um humano
              </span>
            )}
          </div>

          <div className="min-h-44 space-y-3 rounded-card bg-bg-warm p-4">
            {messages.length === 0 && !sending ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <AiAvatar />
                <p className="text-sm text-ink-soft">
                  Mande uma mensagem como se fosse o cliente no WhatsApp.
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
                        Hermes está digitando…
                      </div>
                    </div>
                  </>
                )}

                {navigation.state === 'submitting' && audioSending && (
                  <div className="mr-auto flex items-start gap-2">
                    <AiAvatar />
                    <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border bg-surface px-3 py-2 text-sm text-ink-soft shadow-sm">
                      <span className="inline-block size-1.5 animate-pulse rounded-full bg-waiting" />
                      Transcrevendo seu áudio e respondendo…
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {actionData?.limitReached ? (
            // Limite não é erro: é o momento de convidar. Quem chegou até aqui gostou.
            <div className="rounded-lg border border-brand/30 bg-brand/8 p-3 text-sm text-ink">
              <p className="font-medium">{actionData.error}</p>
              <p className="mt-1 text-ink-soft">
                Crie sua conta para continuar conversando — e para o Hermes atender no seu WhatsApp.
              </p>
              <Link
                to="/signup"
                className="mt-2 inline-flex rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-deep"
              >
                Criar minha conta
              </Link>
            </div>
          ) : (
            actionData?.error && (
              <div className="rounded-lg border border-urgent/30 bg-urgent/8 p-3 text-sm text-urgent">
                {actionData.error}
              </div>
            )
          )}

          {lastAssistant && lastAssistant.sources.length > 0 && (
            <div className="rounded-lg border border-border bg-surface p-3 text-xs text-ink-soft">
              <p className="flex items-center gap-1.5 font-medium text-ink">
                <WingMark accent className="size-3.5 text-brand" />
                Fontes da última resposta
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {lastAssistant.sources.map((source) => (
                  <li key={source.fileName}>
                    {source.title} <span className="text-ink-soft/60">({source.fileName})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

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
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          {selectedConversationId && (
            <input type="hidden" name="conversationId" value={selectedConversationId} />
          )}
          <textarea
            ref={textareaRef}
            name="message"
            required
            rows={3}
            disabled={sending}
            onChange={(event) => setHasDraft(event.target.value.trim().length > 0)}
            placeholder="Mensagem do cliente..."
            className={cx(
              'w-full rounded-lg border border-border bg-surface p-2.5 text-sm text-ink placeholder:text-ink-soft/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              sending && 'opacity-60',
            )}
          />
          <Button type="submit" variant="primary" disabled={sending}>
            {sending ? 'Enviando…' : 'Enviar'}
          </Button>
        </Form>

        <section className="space-y-2 border-t border-border pt-4">
          <h2 className="text-sm font-medium text-ink-soft">Ou mande um áudio</h2>
          {hasDraft && (
            <p className="text-xs text-waiting">
              Você tem uma mensagem digitada. Envie ou apague o texto para usar o áudio.
            </p>
          )}
          <AudioRecorder
            tenantSlug={tenantSlug}
            conversationId={selectedConversationId}
            disabled={audioDisabled}
            onSend={() => setAudioSending(true)}
          />
          <Form
            key={`audio-${formKey}`}
            method="post"
            encType="multipart/form-data"
            onSubmit={() => setAudioSending(true)}
            className="flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            {selectedConversationId && (
              <input type="hidden" name="conversationId" value={selectedConversationId} />
            )}
            <input
              type="file"
              name="audio"
              accept="audio/*"
              required
              disabled={audioDisabled}
              className="text-xs text-ink-soft file:mr-2 file:rounded file:border-0 file:bg-bg file:px-3 file:py-1.5 file:text-sm file:text-ink"
            />
            <Button type="submit" variant="secondary" size="sm" disabled={audioDisabled}>
              Enviar arquivo
            </Button>
          </Form>
          <p className="text-xs text-ink-soft/60">
            Você também pode mandar um áudio — a transcrição leva alguns segundos.
          </p>
        </section>
      </main>
    </div>
  )
}
