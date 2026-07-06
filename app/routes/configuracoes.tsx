import type { ReactNode } from 'react'
import { Form, useActionData, useNavigation } from 'react-router'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { TextField } from '../components/ui/TextField'
import { parseTenantConfig, safeDefaultConfig } from '../lib/attendant/tenant-config'
import { resolveTenantConfig, saveTenantConfigToDb } from '../lib/attendant/tenant-config-db.server'
import { requireOwner } from '../lib/auth.server'
import { cx } from '../lib/ui'
import type { Route } from './+types/configuracoes'

// Catálogo fixo (espelha ToolName/TenantObjective do tenant-config). A tela só
// liga/desliga e edita texto — nunca inventa comportamento.
const KNOWN_TOOLS = [
  { name: 'abrir_chamado', label: 'Abrir chamado' },
  { name: 'consultar_chamados', label: 'Consultar chamados' },
  { name: 'pedir_agendamento', label: 'Pedir agendamento' },
] as const

const OBJECTIVE_OPTIONS = [
  { value: 'tirar_duvidas', label: 'Tirar dúvidas' },
  { value: 'qualificar_lead', label: 'Qualificar lead' },
  { value: 'agendar', label: 'Agendar' },
  { value: 'abrir_chamado', label: 'Abrir chamado' },
  { value: 'vender', label: 'Vender' },
] as const

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOwner(request)
  const config =
    (await resolveTenantConfig(operator.tenantSlug)) ?? safeDefaultConfig(operator.tenantSlug)
  return { config, operator: { username: operator.username, tenantSlug: operator.tenantSlug } }
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Hermes — Configurações' },
    { name: 'description', content: 'Descreva como sua empresa atende: perfil, regras e ações.' },
  ]
}

export async function action({ request }: Route.ActionArgs) {
  const operator = await requireOwner(request)
  const form = await request.formData()
  const str = (name: string) => String(form.get(name) ?? '').trim()
  // Campos de lista vêm como textarea (uma por linha).
  const lines = (name: string) =>
    String(form.get(name) ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

  // Parte do config atual (limits das tools, sourceDir, opcionais) é PRESERVADA —
  // a tela edita só o que mostra, sem apagar o resto.
  const current =
    (await resolveTenantConfig(operator.tenantSlug)) ?? safeDefaultConfig(operator.tenantSlug)

  const raw = {
    businessProfile: {
      name: str('name'),
      segment: str('segment'),
      tone: str('tone'),
      workingHours: str('workingHours') || undefined,
      address: str('address') || undefined,
    },
    objectives: form.getAll('objectives').map(String),
    knowledge: {
      sourceDir: current.knowledge.sourceDir,
      sourcePolicy: str('sourcePolicy'),
    },
    tools: KNOWN_TOOLS.map((tool) => {
      const existing = current.tools.find((t) => t.name === tool.name)
      return {
        name: tool.name,
        enabled: form.get(`tool_${tool.name}`) === 'on',
        ...(existing?.limits ? { limits: existing.limits } : {}),
      }
    }),
    guardrails: {
      neverPromise: lines('neverPromise'),
      ...(current.guardrails.forbiddenTopics
        ? { forbiddenTopics: current.guardrails.forbiddenTopics }
        : {}),
      ...(current.guardrails.maxDiscountPercent != null
        ? { maxDiscountPercent: current.guardrails.maxDiscountPercent }
        : {}),
    },
    escalationPolicy: {
      triggers: lines('triggers'),
      defaultReason: str('defaultReason'),
      humanMessage: str('humanMessage'),
    },
    extraRules: lines('extraRules'),
    // Preserva o próximo-passo do tenant (a tela ainda não o edita, mas não deve apagá-lo).
    ...(current.nextStepPrompt ? { nextStepPrompt: current.nextStepPrompt } : {}),
  }

  try {
    const parsed = parseTenantConfig(operator.tenantSlug, raw)
    await saveTenantConfigToDb(parsed)
    return { ok: true as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao salvar.'
    return { ok: false as const, error: message }
  }
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-display text-base font-bold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 mb-3 text-xs text-ink-soft">{hint}</p>}
      <div className={cx('space-y-3', !hint && 'mt-3')}>{children}</div>
    </Card>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-xs text-ink-soft">{children}</span>
}

const textareaClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand'

export default function Configuracoes({ loaderData }: Route.ComponentProps) {
  const { config, operator } = loaderData
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const saving = navigation.state !== 'idle'

  return (
    <AppShell operator={operator}>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Configurações</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Descreva como sua empresa atende. A IA decide a conversa dentro destas regras — você
            informa a regra, não o caminho.
          </p>
        </header>

        <Form method="post" className="mt-5 space-y-4">
          <Section title="Perfil da empresa">
            <TextField
              label="Nome"
              name="name"
              defaultValue={config.businessProfile.name}
              required
            />
            <TextField
              label="Segmento"
              name="segment"
              defaultValue={config.businessProfile.segment}
              required
            />
            <TextField
              label="Tom de voz"
              name="tone"
              defaultValue={config.businessProfile.tone}
              placeholder="curto, natural e cordial"
              required
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Horário de atendimento (opcional)"
                name="workingHours"
                defaultValue={config.businessProfile.workingHours ?? ''}
              />
              <TextField
                label="Endereço (opcional)"
                name="address"
                defaultValue={config.businessProfile.address ?? ''}
              />
            </div>
          </Section>

          <Section title="Objetivos" hint="O que a IA tenta fazer em cada conversa.">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {OBJECTIVE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="objectives"
                    value={opt.value}
                    defaultChecked={config.objectives.includes(opt.value)}
                    className="size-4 accent-brand"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </Section>

          <Section
            title="Base de conhecimento"
            hint={`Documentos em ${config.knowledge.sourceDir}/ (edite os arquivos por enquanto).`}
          >
            <label className="block">
              <FieldLabel>Política de resposta</FieldLabel>
              <select
                name="sourcePolicy"
                defaultValue={config.knowledge.sourcePolicy}
                className={textareaClass}
              >
                <option value="answer_only_from_knowledge">
                  Responder só com base nos documentos
                </option>
                <option value="allow_general_smalltalk">
                  Permitir conversa geral além dos documentos
                </option>
              </select>
            </label>
          </Section>

          <Section
            title="Ferramentas"
            hint="Ações que a IA pode propor (o balcão valida e executa)."
          >
            <div className="space-y-2">
              {KNOWN_TOOLS.map((tool) => {
                const enabled = config.tools.find((t) => t.name === tool.name)?.enabled ?? false
                return (
                  <label key={tool.name} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      name={`tool_${tool.name}`}
                      defaultChecked={enabled}
                      className="size-4 accent-brand"
                    />
                    {tool.label}
                  </label>
                )
              })}
            </div>
          </Section>

          <Section
            title="Escalação para humano"
            hint="Quando a IA deve chamar uma pessoa, e o que dizer ao cliente."
          >
            <label className="block">
              <FieldLabel>Gatilhos (um por linha)</FieldLabel>
              <textarea
                name="triggers"
                rows={3}
                defaultValue={config.escalationPolicy.triggers.join('\n')}
                placeholder={'contrato\norçamento grande'}
                className={textareaClass}
              />
            </label>
            <TextField
              label="Motivo padrão"
              name="defaultReason"
              defaultValue={config.escalationPolicy.defaultReason}
              required
            />
            <label className="block">
              <FieldLabel>Mensagem ao cliente ao escalar</FieldLabel>
              <textarea
                name="humanMessage"
                rows={2}
                defaultValue={config.escalationPolicy.humanMessage}
                required
                className={textareaClass}
              />
            </label>
          </Section>

          <Section
            title="Guard-rails e regras"
            hint="Promessas proibidas e orientações extras — aplicadas pelo código, não pelo prompt."
          >
            <label className="block">
              <FieldLabel>Nunca prometer (um por linha)</FieldLabel>
              <textarea
                name="neverPromise"
                rows={2}
                defaultValue={config.guardrails.neverPromise.join('\n')}
                className={textareaClass}
              />
            </label>
            <label className="block">
              <FieldLabel>Regras extras (uma por linha)</FieldLabel>
              <textarea
                name="extraRules"
                rows={3}
                defaultValue={(config.extraRules ?? []).join('\n')}
                className={textareaClass}
              />
            </label>
          </Section>

          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar configurações'}
            </Button>
            {actionData?.ok && (
              <span className="inline-flex items-center gap-1.5 text-sm text-brand">
                <span className="size-1.5 rounded-full bg-brand" />
                Salvo
              </span>
            )}
            {actionData?.ok === false && (
              <span className="inline-flex items-center gap-1.5 text-sm text-urgent">
                <span className="size-1.5 rounded-full bg-urgent" />
                {actionData.error}
              </span>
            )}
          </div>
        </Form>
      </div>
    </AppShell>
  )
}
