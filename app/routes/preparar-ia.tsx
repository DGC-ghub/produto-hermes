import { useEffect, useRef, useState } from 'react'
import {
  data,
  Form,
  Link,
  redirect,
  useFetcher,
  useNavigation,
  useSearchParams,
} from 'react-router'
import { WingMark } from '../components/brand/BrandMark'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { requireOwner } from '../lib/auth.server'
import {
  type FieldDef,
  isStepComplete,
  missingFieldsByStep,
  SETUP_FIELDS,
  SETUP_STEPS,
  type SetupAnswers,
  type SetupStep,
  setupProgress,
} from '../lib/setup/answers'
import {
  loadSetupWorkspace,
  reopenForChanges,
  StaleRevisionError,
  SubmitNotReadyError,
  saveDraftAnswers,
  submitDraft,
} from '../lib/setup/version.server'
import { cx } from '../lib/ui'
import type { Route } from './+types/preparar-ia'

// O onboarding assistido: o cliente responde perguntas em português comum e nossos agentes
// traduzem isso em configuração (spec §5). Ele NUNCA escreve base de conhecimento, prompt
// ou regra técnica — foi exatamente por pedir isso que três dos sete tenants ficaram com
// zero documentos.
//
// A tela é derivada do catálogo `SETUP_FIELDS`: acrescentar uma pergunta é acrescentar uma
// entrada lá, não mexer aqui.

const STEP_LABEL: Record<SetupStep, string> = {
  empresa: 'Sobre a empresa',
  servicos: 'Serviços',
  operacao: 'Atendimento',
  seguranca: 'Segurança',
}

const STEP_HINT: Record<SetupStep, string> = {
  empresa: 'O básico para a IA saber de quem ela está falando.',
  servicos: 'O que vocês fazem — e, tão importante quanto, o que não fazem.',
  operacao: 'Como o atendimento funciona no dia a dia.',
  seguranca: 'Os limites da IA. Esta etapa inteira é obrigatória.',
}

function isStep(value: unknown): value is SetupStep {
  return typeof value === 'string' && (SETUP_STEPS as readonly string[]).includes(value)
}

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOwner(request)
  const { version, published, activated } = await loadSetupWorkspace(operator.tenantId)

  const url = new URL(request.url)
  const pedida = url.searchParams.get('etapa')
  const step: SetupStep = isStep(pedida) ? pedida : 'empresa'
  const answers = version?.answers ?? {}

  return {
    step,
    versionId: version?.id ?? null,
    revision: version?.revision ?? 0,
    // O estado da versão APONTADA por reviewVersionId — inclusive `submitted`, que é o
    // que faz a tela de "recebemos" aparecer em vez de um questionário novo.
    state: version?.state ?? null,
    reviewNote: version?.reviewNote ?? null,
    published,
    activated,
    answers,
    progress: setupProgress(answers),
    stepsDone: SETUP_STEPS.map((s) => isStepComplete(s, answers)),
    missing: missingFieldsByStep(answers),
    operator: { username: operator.username, tenantSlug: operator.tenantSlug },
  }
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Hermes — Preparar minha IA' },
    { name: 'description', content: 'Responda algumas perguntas e nós preparamos sua IA.' },
  ]
}

/** Lê as respostas de UMA etapa do formulário. O resto do rascunho é preservado. */
function readStepAnswers(form: FormData, step: SetupStep, atual: SetupAnswers): SetupAnswers {
  const answers: SetupAnswers = { ...atual }
  for (const field of SETUP_FIELDS.filter((f) => f.step === step)) {
    const raw = String(form.get(field.key) ?? '')
    answers[field.key] =
      field.kind === 'list'
        ? raw
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
        : raw
  }
  return answers
}

export async function action({ request }: Route.ActionArgs) {
  const operator = await requireOwner(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const versionId = String(form.get('versionId') ?? '')
  // `Number('')` é 0, não NaN: sem exigir dígitos, um formulário sem `revision` salvaria
  // com revisão 0 e poderia casar por acidente com uma versão recém-criada.
  const revisionRaw = String(form.get('revision') ?? '')
  const expectedRevision = /^\d+$/.test(revisionRaw) ? Number(revisionRaw) : Number.NaN
  const pedida = form.get('step')
  const step: SetupStep = isStep(pedida) ? pedida : 'empresa'

  // A versão vem do BANCO pelo tenant da sessão: o versionId do formulário é conferido
  // contra ela, nunca usado como autoridade.
  const { version } = await loadSetupWorkspace(operator.tenantId)
  if (!version || version.id !== versionId || Number.isNaN(expectedRevision)) {
    return conflito()
  }

  if (intent === 'reabrir') {
    try {
      await reopenForChanges({
        versionId: version.id,
        tenantId: operator.tenantId,
        expectedRevision,
      })
      return redirect('/preparar-ia')
    } catch (error) {
      if (error instanceof StaleRevisionError) {
        return conflito()
      }
      console.error('[preparar-ia] falha ao reabrir para correção', error)
      return data({ ok: false as const, stale: false as const, error: FALHA }, { status: 500 })
    }
  }

  if (intent === 'enviar') {
    try {
      await submitDraft({
        versionId: version.id,
        tenantId: operator.tenantId,
        accountId: operator.accountId,
        expectedRevision,
      })
      return redirect('/preparar-ia')
    } catch (error) {
      if (error instanceof SubmitNotReadyError) {
        return data({ ok: false as const, stale: false as const, error: FALTAM }, { status: 422 })
      }
      if (error instanceof StaleRevisionError) {
        return conflito()
      }
      console.error('[preparar-ia] falha ao enviar para revisão', error)
      return data({ ok: false as const, stale: false as const, error: FALHA }, { status: 500 })
    }
  }

  try {
    const salvo = await saveDraftAnswers({
      versionId: version.id,
      tenantId: operator.tenantId,
      answers: readStepAnswers(form, step, version.answers),
      expectedRevision,
    })
    return { ok: true as const, stale: false as const, revision: salvo.revision }
  } catch (error) {
    if (error instanceof StaleRevisionError) {
      // Outra aba (ou outro sócio) salvou antes. Não sobrescrevemos em silêncio.
      return conflito()
    }
    console.error('[preparar-ia] falha ao salvar', error)
    return data({ ok: false as const, stale: false as const, error: FALHA }, { status: 500 })
  }
}

/**
 * Conflito de concorrência. Status 409 de verdade — o corpo continua amigável, mas o
 * código HTTP precisa dizer o que houve: um 200 faria qualquer cliente (e o próprio
 * fetcher) tratar a recusa como sucesso.
 */
function conflito() {
  return data({ ok: false as const, stale: true, error: RECARREGAR }, { status: 409 })
}

const RECARREGAR =
  'Estas respostas foram alteradas em outra aba. Recarregue a página para continuar de onde parou.'
const FALHA = 'Não consegui salvar agora. Tente de novo em instantes.'
const FALTAM = 'Ainda faltam informações obrigatórias.'

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/60 focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand'

function Campo({ field, value }: { field: FieldDef; value: string | string[] | undefined }) {
  const texto = Array.isArray(value) ? value.join('\n') : (value ?? '')
  const id = `campo-${field.key}`
  const helpId = field.help ? `${id}-ajuda` : undefined
  return (
    <div className="block">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {field.label}
        {field.required && (
          <>
            {/* O asterisco é decoração; quem usa leitor de tela ouve a palavra. */}
            <span className="ml-1 text-urgent" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(obrigatório)</span>
          </>
        )}
      </label>
      {field.help && (
        <p id={helpId} className="mb-1.5 text-xs text-ink-soft">
          {field.help}
        </p>
      )}
      <textarea
        id={id}
        name={field.key}
        // Lista ganha mais linhas: uma por item é o formato que a pergunta pede.
        rows={field.kind === 'list' ? 4 : 2}
        defaultValue={texto}
        placeholder={field.placeholder}
        aria-describedby={helpId}
        aria-required={field.required || undefined}
        className={inputClass}
      />
    </div>
  )
}

export default function PrepararIa({ loaderData }: Route.ComponentProps) {
  const { step, versionId, revision, state, reviewNote, answers, progress, stepsDone, operator } =
    loaderData
  const fetcher = useFetcher<typeof action>()
  const navigation = useNavigation()
  const [, setSearchParams] = useSearchParams()
  const formRef = useRef<HTMLFormElement>(null)
  const [salvoEm, setSalvoEm] = useState<string | null>(null)

  const indice = SETUP_STEPS.indexOf(step)
  const ultima = indice === SETUP_STEPS.length - 1
  const enviando = navigation.state !== 'idle'
  const stale = fetcher.data?.stale === true
  const pronto = progress.done === progress.total
  const salvando = fetcher.state !== 'idle'

  // A revisão que o próximo POST deve usar: enquanto o loader não revalida, quem sabe a
  // revisão atual é a última resposta do autosave. Mandar a do loader faria o segundo
  // salvamento nascer desatualizado e levar 409 de si mesmo.
  const revisaoAtual =
    fetcher.data && 'revision' in fetcher.data && typeof fetcher.data.revision === 'number'
      ? fetcher.data.revision
      : revision

  // Autosave por MUDANÇA, não por render. Um `useEffect` sem lista de dependências rodaria
  // a cada render — e como o submit provoca render, viraria um POST a cada 1,2s para
  // sempre. Aqui o timer só é armado quando o conteúdo muda de fato.
  const [sujo, setSujo] = useState(false)
  useEffect(() => {
    if (!sujo || stale || state !== 'draft' || salvando) {
      return
    }
    const timer = setTimeout(() => {
      const form = formRef.current
      if (form) {
        setSujo(false)
        fetcher.submit(form, { method: 'post' })
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [sujo, stale, state, salvando, fetcher])

  useEffect(() => {
    if (fetcher.data?.ok === true && 'revision' in fetcher.data) {
      setSalvoEm(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
    }
  }, [fetcher.data])

  // Trocar de etapa só DEPOIS que o salvamento confirmou: navegar antes descartaria em
  // silêncio o que a pessoa acabou de escrever se o POST falhasse.
  const [destino, setDestino] = useState<SetupStep | null>(null)
  useEffect(() => {
    if (destino && fetcher.state === 'idle' && fetcher.data?.ok === true) {
      setSearchParams({ etapa: destino })
      setDestino(null)
    }
  }, [destino, fetcher.state, fetcher.data, setSearchParams])

  function irPara(proxima: SetupStep) {
    const form = formRef.current
    if (!form) {
      return
    }
    setSujo(false)
    setDestino(proxima)
    fetcher.submit(form, { method: 'post' })
  }

  /** Casca das telas de estado (nada para preencher agora). */
  function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
    return (
      <AppShell operator={operator}>
        <div className="mx-auto max-w-2xl px-6 py-10">
          <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand-deep">
              <WingMark accent className="size-5 text-white" />
            </span>
            <h1 className="font-display text-xl font-bold text-ink">{titulo}</h1>
            {children}
          </Card>
        </div>
      </AppShell>
    )
  }

  if (state === 'submitted') {
    return (
      <Aviso titulo="Recebemos suas respostas">
        <p className="max-w-md text-sm text-ink-soft">
          Nossa equipe está preparando e conferindo a sua IA. Assim que estiver pronta, você vai
          poder testá-la aqui antes de ligar no WhatsApp.
        </p>
      </Aviso>
    )
  }

  if (state === 'needs_changes') {
    // Reabrir é uma escolha explícita do cliente, não algo que a tela faça sozinha: a
    // transição limpa os artefatos do ciclo anterior (§3.5) e isso precisa ser deliberado.
    return (
      <Aviso titulo="Precisamos de mais algumas informações">
        {reviewNote && (
          <p className="max-w-md rounded-lg bg-bg-warm px-4 py-3 text-sm text-ink">{reviewNote}</p>
        )}
        <p className="max-w-md text-sm text-ink-soft">
          Suas respostas foram guardadas. Ao continuar, você volta ao questionário para ajustar o
          que faltou.
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="reabrir" />
          <input type="hidden" name="versionId" value={versionId ?? ''} />
          <input type="hidden" name="revision" value={revisaoAtual} />
          <Button type="submit" variant="primary" disabled={enviando}>
            {enviando ? 'Abrindo…' : 'Corrigir as respostas'}
          </Button>
        </Form>
      </Aviso>
    )
  }

  if (state === 'ready_to_test') {
    return (
      <Aviso titulo="Sua IA está pronta para testar">
        <p className="max-w-md text-sm text-ink-soft">
          Conferimos a configuração. Faça algumas perguntas antes de ligá-la no WhatsApp.
        </p>
        <Link
          to="/testar-ia"
          className="inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-deep"
        >
          Testar minha IA
        </Link>
      </Aviso>
    )
  }

  if (!versionId) {
    // Já publicado e sem revisão aberta: não abrimos um segundo onboarding sozinhos.
    return (
      <Aviso titulo="Sua IA já está configurada">
        <p className="max-w-md text-sm text-ink-soft">
          Para mudar alguma coisa, use as telas de Configurações e Conhecimento — alterações que
          afetam o que a IA promete passam por uma revisão nossa antes de entrar no ar.
        </p>
      </Aviso>
    )
  }

  return (
    <AppShell operator={operator}>
      <header className="border-b border-border bg-surface px-6 py-4">
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">
          Vamos preparar sua IA
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Responda as perguntas abaixo. Nós transformamos as respostas na configuração — você não
          precisa escrever nada técnico.
        </p>
      </header>

      <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
        <nav className="flex flex-wrap items-center gap-2">
          {SETUP_STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => irPara(s)}
              aria-current={s === step ? 'step' : undefined}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors',
                s === step
                  ? 'bg-brand text-white'
                  : 'border border-border bg-surface text-ink-soft hover:text-ink',
              )}
            >
              <span
                className={cx(
                  'inline-flex size-4 items-center justify-center rounded-full text-[10px]',
                  stepsDone[i] ? 'bg-brand-vivid text-brand-deep' : 'bg-border text-ink-soft',
                )}
              >
                {stepsDone[i] ? '✓' : i + 1}
              </span>
              {STEP_LABEL[s]}
            </button>
          ))}
          <span className="ml-auto text-xs text-ink-soft">
            {progress.done} de {progress.total} etapas
          </span>
        </nav>

        {stale && (
          <div
            role="alert"
            className="rounded-lg border border-waiting/30 bg-waiting/8 p-3 text-sm text-ink"
          >
            {RECARREGAR}
          </div>
        )}
        {fetcher.data?.ok === false && !stale && (
          <div
            role="alert"
            className="rounded-lg border border-urgent/30 bg-urgent/8 p-3 text-sm text-urgent"
          >
            {fetcher.data.error}
          </div>
        )}

        <fetcher.Form ref={formRef} method="post" className="space-y-5">
          <input type="hidden" name="intent" value="salvar" />
          <input type="hidden" name="versionId" value={versionId ?? ''} />
          <input type="hidden" name="revision" value={revisaoAtual} />
          <input type="hidden" name="step" value={step} />

          <Card className="space-y-5 p-5" key={step}>
            <div>
              <h2 className="font-display text-base font-bold text-ink">{STEP_LABEL[step]}</h2>
              <p className="mt-0.5 text-xs text-ink-soft">{STEP_HINT[step]}</p>
            </div>
            {SETUP_FIELDS.filter((f) => f.step === step).map((field) => (
              <Campo key={field.key} field={field} value={answers[field.key]} />
            ))}
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            {indice > 0 && (
              <Button
                type="button"
                variant="secondary"
                disabled={salvando}
                onClick={() => irPara(SETUP_STEPS[indice - 1])}
              >
                Voltar
              </Button>
            )}
            {!ultima && (
              <Button
                type="button"
                variant="primary"
                disabled={salvando}
                onClick={() => irPara(SETUP_STEPS[indice + 1])}
              >
                {salvando ? 'Salvando…' : 'Salvar e continuar'}
              </Button>
            )}
            <span role="status" aria-live="polite" className="text-xs text-ink-soft">
              {salvando ? 'salvando…' : salvoEm ? `salvo às ${salvoEm}` : ''}
            </span>
          </div>
        </fetcher.Form>

        {ultima && (
          <Card className="space-y-3 p-5">
            <h2 className="font-display text-base font-bold text-ink">Enviar para revisão</h2>
            <p className="text-sm text-ink-soft">
              {pronto
                ? 'Tudo respondido. Nossa equipe prepara e confere a configuração antes de a IA falar com alguém.'
                : 'Ainda faltam respostas obrigatórias — complete as etapas marcadas para poder enviar.'}
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="enviar" />
              <input type="hidden" name="versionId" value={versionId ?? ''} />
              <input type="hidden" name="revision" value={revisaoAtual} />
              <Button type="submit" variant="primary" disabled={!pronto || enviando}>
                {enviando ? 'Enviando…' : 'Enviar para revisão'}
              </Button>
            </Form>
            {!pronto && (
              <p className="text-xs text-ink-soft">
                Falta preencher:{' '}
                {SETUP_STEPS.filter((_, i) => !stepsDone[i])
                  .map((s) => STEP_LABEL[s])
                  .join(', ')}
                .{' '}
                <Link
                  to={`?etapa=${SETUP_STEPS.find((_, i) => !stepsDone[i])}`}
                  className="font-medium text-ink underline"
                >
                  Ir para a primeira
                </Link>
              </p>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  )
}
