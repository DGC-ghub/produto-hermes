import { Link } from 'react-router'
import type { OnboardingStatus } from '../lib/onboarding.server'
import { cx } from '../lib/ui'
import { Card } from './ui/Card'

// Checklist de primeiros passos, mostrado no topo do /atendente enquanto o tenant novo
// ainda não completou a configuração. Some sozinho quando os 3 passos estão feitos.
export function OnboardingChecklist({ status }: { status: OnboardingStatus }) {
  return (
    <Card className="mb-5 border-brand/30 bg-brand/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-ink">Configure seu atendente</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Faltam alguns passos pra sua IA atender de verdade.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-brand/15 px-2.5 py-1 text-xs font-medium text-brand-deep">
          {status.doneCount} de {status.total}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {status.steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2.5">
            <span
              className={cx(
                'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                step.done ? 'bg-brand text-white' : 'border border-border bg-surface text-ink-soft',
              )}
              aria-hidden
            >
              {step.done ? '✓' : ''}
            </span>
            {step.done ? (
              <span className="text-sm text-ink-soft line-through">{step.label}</span>
            ) : (
              <Link to={step.href} className="text-sm font-medium text-brand hover:underline">
                {step.label} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
