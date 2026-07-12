import QRCode from 'qrcode'
import { useEffect } from 'react'
import { Form, redirect, useActionData, useNavigation, useRevalidator } from 'react-router'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { TextField } from '../components/ui/TextField'
import { db } from '../db.server'
import { requireOwner } from '../lib/auth.server'
import { cx } from '../lib/ui'
import { ensureBaileysWired } from '../lib/whatsapp-queue.server'
import type { Route } from './+types/canais'

function baileysEnabled(): boolean {
  return process.env.BAILEYS_ENABLED === '1'
}

const STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  conectado: { label: 'Conectado', dot: 'bg-brand', text: 'text-brand' },
  pareando: { label: 'Escaneie o QR', dot: 'bg-waiting', text: 'text-waiting' },
  derrubado: { label: 'Caiu — reconecte', dot: 'bg-urgent', text: 'text-urgent' },
  desconectado: { label: 'Desconectado', dot: 'bg-ink-soft/40', text: 'text-ink-soft' },
}

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOwner(request)
  const rows = await db.channelSession.findMany({
    where: { tenantId: operator.tenantId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, label: true, waNumber: true, status: true },
  })

  const enabled = baileysEnabled()
  let sessions = rows.map((r) => ({ ...r, qrDataUrl: null as string | null }))
  // O QR e o status ao vivo vêm da MEMÓRIA do gerente (o banco tem o último salvo).
  if (enabled && rows.length > 0) {
    await ensureBaileysWired()
    const mgr = await import('../lib/channels/baileys.server')
    sessions = await Promise.all(
      rows.map(async (r) => {
        const view = mgr.getSessionView(r.id)
        const status = view.status !== 'desconectado' ? view.status : r.status
        const qrDataUrl = view.qr ? await QRCode.toDataURL(view.qr) : null
        return { ...r, status, qrDataUrl }
      }),
    )
  }

  return {
    sessions,
    enabled,
    operator: { username: operator.username, tenantSlug: operator.tenantSlug },
  }
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Hermes — Canais' },
    { name: 'description', content: 'Conecte o WhatsApp da sua empresa por QR, em minutos.' },
  ]
}

export async function action({ request }: Route.ActionArgs) {
  const operator = await requireOwner(request)
  if (!baileysEnabled()) {
    return { error: 'O canal por QR está desligado nesta conta. Fale com o suporte.' }
  }
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  await ensureBaileysWired()
  const mgr = await import('../lib/channels/baileys.server')

  if (intent === 'nova') {
    const label = String(form.get('label') ?? '').trim() || null
    const session = await db.channelSession.create({
      data: { tenantId: operator.tenantId, kind: 'baileys', label },
    })
    const result = await mgr.startPairing(session.id)
    if (!result.ok) {
      return { error: result.error }
    }
    return redirect('/canais')
  }

  const sessionId = String(form.get('sessionId') ?? '')
  // Isolamento: só age em sessão do PRÓPRIO tenant (não confia só no requireOwner).
  const owned = await db.channelSession.findFirst({
    where: { id: sessionId, tenantId: operator.tenantId },
    select: { id: true },
  })
  if (!owned) {
    return { error: 'Sessão não encontrada.' }
  }
  if (intent === 'parear') {
    const result = await mgr.startPairing(sessionId)
    if (!result.ok) {
      return { error: result.error }
    }
  } else if (intent === 'desconectar') {
    await mgr.disconnect(sessionId, true) // logout: exige novo QR pra reconectar
  }
  return redirect('/canais')
}

export default function Canais({ loaderData }: Route.ComponentProps) {
  const { sessions, enabled, operator } = loaderData
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const busy = navigation.state !== 'idle'
  const revalidator = useRevalidator()

  // Enquanto houver sessão pareando, atualiza o QR/status a cada 2,5s (o QR expira).
  const anyPairing = sessions.some((s) => s.status === 'pareando')
  useEffect(() => {
    if (!anyPairing) {
      return
    }
    const timer = setInterval(() => revalidator.revalidate(), 2500)
    return () => clearInterval(timer)
  }, [anyPairing, revalidator])

  return (
    <AppShell operator={operator}>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-5">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Canais</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Conecte o WhatsApp da sua empresa por QR — escaneie uma vez e o Hermes atende por lá.
          </p>
        </header>

        {!enabled && (
          <Card className="mb-4 border-waiting/30 bg-waiting/5 p-4 text-sm text-ink-soft">
            O canal por QR ainda não está liberado nesta conta. Enquanto isso, você pode usar o
            WhatsApp oficial em{' '}
            <a href="/conectar-whatsapp" className="text-brand underline">
              Conectar WhatsApp
            </a>
            .
          </Card>
        )}

        {actionData?.error && (
          <Card className="mb-4 border-urgent/30 bg-urgent/5 p-3 text-sm text-urgent">
            {actionData.error}
          </Card>
        )}

        {sessions.length > 0 && (
          <div className="mb-4 space-y-3">
            {sessions.map((s) => {
              const meta = STATUS_META[s.status] ?? STATUS_META.desconectado
              return (
                <Card key={s.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{s.label || 'WhatsApp'}</p>
                      <p className={cx('mt-0.5 flex items-center gap-1.5 text-sm', meta.text)}>
                        <span className={cx('size-1.5 rounded-full', meta.dot)} />
                        {meta.label}
                        {s.waNumber && (
                          <span className="text-ink-soft">
                            {' · '}
                            <span className="font-mono text-xs">{s.waNumber}</span>
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {s.status !== 'conectado' && s.status !== 'pareando' && (
                        <Form method="post">
                          <input type="hidden" name="sessionId" value={s.id} />
                          <Button
                            type="submit"
                            name="intent"
                            value="parear"
                            size="sm"
                            disabled={busy}
                          >
                            Reconectar
                          </Button>
                        </Form>
                      )}
                      {s.status !== 'desconectado' && (
                        <Form method="post">
                          <input type="hidden" name="sessionId" value={s.id} />
                          <Button
                            type="submit"
                            name="intent"
                            value="desconectar"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                          >
                            Desconectar
                          </Button>
                        </Form>
                      )}
                    </div>
                  </div>

                  {s.status === 'pareando' && (
                    <div className="mt-3 flex flex-col items-center gap-2 rounded-card bg-bg-warm p-4 text-center">
                      {s.qrDataUrl ? (
                        // biome-ignore lint/performance/noImgElement: QR é data URL local, sem loader de imagem
                        <img
                          src={s.qrDataUrl}
                          alt="QR code para conectar o WhatsApp"
                          className="size-56"
                        />
                      ) : (
                        <p className="text-sm text-ink-soft">Gerando o QR…</p>
                      )}
                      <p className="max-w-xs text-xs text-ink-soft">
                        No celular: WhatsApp → <b>Aparelhos conectados</b> →{' '}
                        <b>Conectar um aparelho</b> → aponte pra este QR.
                      </p>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}

        {enabled && (
          <Card className="p-5">
            <h2 className="font-display text-base font-bold text-ink">Conectar um novo número</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Damos um QR; você escaneia com o WhatsApp da empresa e pronto.
            </p>
            <Form method="post" className="mt-3 space-y-3">
              <TextField label="Apelido (opcional)" name="label" placeholder="Ex.: Recepção" />
              <Button type="submit" name="intent" value="nova" variant="primary" disabled={busy}>
                {busy ? 'Gerando QR…' : 'Conectar por QR'}
              </Button>
            </Form>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
