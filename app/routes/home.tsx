import { Link } from 'react-router'
import { WingMark } from '../components/brand/BrandMark'
import { PublicHeader } from '../components/layout/PublicHeader'
import { Button } from '../components/ui/Button'
import type { Route } from './+types/home'

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Hermes — o atendente de WhatsApp que lembra de cada cliente' },
    {
      name: 'description',
      content:
        'O Hermes atende, qualifica e registra cada conversa do seu WhatsApp sozinho — e chama você na hora certa, com a ficha do cliente na mão. Sem desenhar fluxo.',
    },
  ]
}

const BENEFITS = [
  {
    title: 'Atende sozinho, dia e noite',
    body: 'Você descreve como a empresa funciona. A IA conversa, tira dúvidas e qualifica — sem fluxo pra montar.',
  },
  {
    title: 'Lembra de cada cliente',
    body: 'Reconhece quem já falou com você e retoma de onde parou. Cada conversa vira um dossiê.',
  },
  {
    title: 'Chama você na hora certa',
    body: 'Quando precisa de gente, escala pra você já com o resumo e o contexto. Nada se perde no caminho.',
  },
]

const CATEGORY = [
  { tool: 'Inbox (Callbell)', who: 'o humano atende' },
  { tool: 'Funil (ManyChat)', who: 'você desenha o fluxo' },
  { tool: 'Hermes', who: 'a IA opera' },
]

// Prévia de uma conversa real operada pela IA — mostra o produto em uma olhada.
function ChatPreview() {
  return (
    <div className="rounded-card border border-border bg-surface p-3 shadow-[0_16px_36px_-16px_rgba(10,60,46,0.4)]">
      <div className="mb-2.5 flex items-center gap-2 border-b border-border pb-2.5">
        <span className="size-2 rounded-full bg-brand-vivid" />
        <span className="text-xs text-ink-soft">WhatsApp · Clínica Sorriso</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="max-w-[85%] self-start rounded-[11px] rounded-bl-[3px] bg-bg px-2.5 py-1.5 text-[13px] text-ink">
          Oi, vocês fazem site? Quanto custa?
        </p>
        <p className="flex max-w-[88%] items-start gap-1.5 self-end rounded-[11px] rounded-br-[3px] bg-brand/12 px-2.5 py-1.5 text-[13px] text-ink">
          <WingMark accent className="mt-0.5 size-3.5 shrink-0 text-brand" />
          Fazemos! A partir de R$ 2.500. É pra sua clínica? Posso te mandar exemplos.
        </p>
        <p className="max-w-[85%] self-start rounded-[11px] rounded-bl-[3px] bg-bg px-2.5 py-1.5 text-[13px] text-ink">
          Isso, uma clínica odonto
        </p>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-brand/8 px-2.5 py-1.5 text-xs text-brand">
        <span className="size-1.5 rounded-full bg-brand" />
        lead registrado · clínica odonto · interesse: site
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <PublicHeader />

      <main>
        <section className="relative overflow-hidden bg-bg-warm">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.7]"
            style={{ backgroundImage: 'url(/brand/pattern.svg)' }}
          />
          <div className="relative mx-auto grid max-w-5xl items-center gap-10 px-6 py-16 lg:grid-cols-2">
            <div>
              <span className="inline-block rounded-full border border-brand/30 bg-surface px-3 py-1 text-xs font-medium text-brand">
                IA operacional para WhatsApp
              </span>
              <h1 className="mt-3.5 font-display text-4xl font-extrabold leading-[1.04] tracking-tight text-ink sm:text-5xl">
                O atendente de WhatsApp que lembra de cada cliente
              </h1>
              <p className="mt-4 max-w-md text-base leading-relaxed text-ink-soft">
                O Hermes atende, qualifica e registra cada conversa sozinho — e chama você na hora
                certa, com a ficha do cliente na mão. Sem desenhar fluxo nenhum.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/signup">
                  <Button variant="primary">Testar grátis</Button>
                </Link>
                <Link to="/demo/chat">
                  <Button variant="secondary">Ver demo de 2 min</Button>
                </Link>
              </div>
            </div>
            <ChatPreview />
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-14">
          <div className="grid gap-8 sm:grid-cols-3">
            {BENEFITS.map((benefit) => (
              <div key={benefit.title}>
                <WingMark accent className="size-6 text-brand" />
                <h3 className="mt-2 font-display text-lg font-bold text-ink">{benefit.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{benefit.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="rounded-card border border-border bg-surface p-6">
            <h2 className="font-display text-xl font-bold text-ink">
              Não é mais um construtor de fluxo
            </h2>
            <p className="mt-1.5 text-sm text-ink-soft">
              Você informa a <span className="font-medium text-ink">regra</span> — não o caminho. A
              IA decide a conversa dentro disso.
            </p>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              {CATEGORY.map((item) => {
                const isHermes = item.tool === 'Hermes'
                return (
                  <div
                    key={item.tool}
                    className={
                      isHermes ? 'rounded-lg bg-brand-deep p-3.5' : 'rounded-lg bg-bg p-3.5'
                    }
                  >
                    <p className={isHermes ? 'text-brand-vivid' : 'text-ink-soft'}>{item.tool}</p>
                    <p className={isHermes ? 'mt-0.5 text-white' : 'mt-0.5 text-ink'}>{item.who}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="bg-brand-deep">
          <div className="mx-auto max-w-5xl px-6 py-16 text-center">
            <h2 className="font-display text-3xl font-bold text-white">
              Pare de perder cliente no WhatsApp
            </h2>
            <p className="mx-auto mt-2.5 max-w-md text-sm text-white/75">
              Configure em minutos, descrevendo seu negócio. Sem cartão pra testar.
            </p>
            <Link
              to="/signup"
              className="mt-6 inline-block rounded-lg bg-brand-vivid px-6 py-3 font-display text-base font-semibold text-brand-deep transition-colors hover:bg-white"
            >
              Testar grátis
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-6 text-xs text-ink-soft">
        <WingMark className="size-4 text-brand" />
        Hermes · um produto DGC Hub · 2026
      </footer>
    </div>
  )
}
