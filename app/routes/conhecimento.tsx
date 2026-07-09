import { Form, Link, redirect, useActionData, useNavigation } from 'react-router'
import { WingMark } from '../components/brand/BrandMark'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { TextField } from '../components/ui/TextField'
import { requireOwner } from '../lib/auth.server'
import {
  deleteKnowledgeDoc,
  listKnowledgeDocs,
  writeKnowledgeDoc,
} from '../lib/knowledge-db.server'
import { cx } from '../lib/ui'
import type { Route } from './+types/conhecimento'

const textareaClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand'

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOwner(request)
  const docs = await listKnowledgeDocs(operator.tenantSlug)
  const editId = new URL(request.url).searchParams.get('edit')
  const editing = editId ? (docs.find((d) => d.id === editId) ?? null) : null
  return {
    docs,
    editing,
    operator: { username: operator.username, tenantSlug: operator.tenantSlug },
  }
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Hermes — Base de conhecimento' },
    { name: 'description', content: 'O que a IA sabe sobre a sua empresa: serviços, preços, FAQ.' },
  ]
}

export async function action({ request }: Route.ActionArgs) {
  const operator = await requireOwner(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  try {
    if (intent === 'delete') {
      await deleteKnowledgeDoc(operator.tenantSlug, String(form.get('id') ?? ''))
      return redirect('/conhecimento')
    }
    const id = String(form.get('id') ?? '') || undefined
    await writeKnowledgeDoc(operator.tenantSlug, {
      id,
      title: String(form.get('title') ?? ''),
      content: String(form.get('content') ?? ''),
    })
    return redirect('/conhecimento')
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Não consegui salvar. Tente de novo.' }
  }
}

function preview(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat
}

export default function Conhecimento({ loaderData }: Route.ComponentProps) {
  const { docs, editing, operator } = loaderData
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const saving = navigation.state !== 'idle'

  return (
    <AppShell operator={operator}>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-5">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            Base de conhecimento
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            É o que a IA sabe sobre a sua empresa — serviços, preços, políticas, perguntas
            frequentes. Quanto mais completa, menos ela precisa escalar para você.
          </p>
        </header>

        <Card className="p-5">
          <h2 className="font-display text-base font-bold text-ink">
            {editing ? 'Editar documento' : 'Adicionar documento'}
          </h2>
          <Form method="post" className="mt-3 space-y-3" key={editing?.id ?? 'novo'}>
            <input type="hidden" name="intent" value="save" />
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <TextField
              label="Título"
              name="title"
              required
              defaultValue={editing?.title ?? ''}
              placeholder="Ex.: Serviços e preços"
            />
            <label className="block">
              <span className="mb-1.5 block text-xs text-ink-soft">Conteúdo</span>
              <textarea
                name="content"
                required
                rows={8}
                defaultValue={editing?.content ?? ''}
                placeholder="Cole aqui as informações — ex.: tabela de preços, horários, o que a empresa faz, respostas para as dúvidas mais comuns."
                className={textareaClass}
              />
            </label>
            {actionData?.error && <p className="text-sm text-urgent">{actionData.error}</p>}
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Salvando…' : editing ? 'Salvar alterações' : 'Adicionar'}
              </Button>
              {editing && (
                <Link to="/conhecimento" className="text-sm text-ink-soft hover:text-ink">
                  Cancelar
                </Link>
              )}
            </div>
          </Form>
        </Card>

        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-ink-soft">
            {docs.length > 0
              ? `${docs.length} documento${docs.length > 1 ? 's' : ''}`
              : 'Nenhum documento ainda'}
          </h2>

          {docs.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-deep">
                <WingMark accent className="size-5 text-white" />
              </span>
              <p className="max-w-sm text-sm text-ink-soft">
                Sua IA ainda não tem sobre o que falar. Adicione o primeiro documento acima — pode
                ser a lista de serviços, a tabela de preços ou as dúvidas mais comuns.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {docs.map((doc) => (
                <Card
                  key={doc.id}
                  className={cx(
                    'flex items-start justify-between gap-3 p-4',
                    editing?.id === doc.id && 'ring-2 ring-brand',
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{doc.title}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">{preview(doc.content)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      to={`/conhecimento?edit=${doc.id}`}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-bg-warm hover:text-ink"
                    >
                      Editar
                    </Link>
                    <Form
                      method="post"
                      onSubmit={(event) => {
                        if (!window.confirm(`Remover "${doc.title}"?`)) {
                          event.preventDefault()
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={doc.id} />
                      <button
                        type="submit"
                        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-urgent/10 hover:text-urgent"
                      >
                        Remover
                      </button>
                    </Form>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
