import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'
import type { Route } from './+types/root'
import { WingMark } from './components/brand/BrandMark'
import './app.css'

export const links: Route.LinksFunction = () => [
  { rel: 'icon', href: '/brand/favicon.svg', type: 'image/svg+xml' },
  { rel: 'icon', href: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
  { rel: 'apple-touch-icon', href: '/brand/icon-512.png' },
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Hanken+Grotesk:wght@400..700&display=swap',
  },
]

// Metadados padrão (título, descrição, Open Graph). Rotas individuais podem
// sobrescrever o título; o og:image usa a peça social do kit de marca.
export const meta: Route.MetaFunction = () => [
  { title: 'Hermes — o atendente de WhatsApp que lembra de cada cliente' },
  {
    name: 'description',
    content:
      'O Hermes atende seus clientes no WhatsApp, lembra de cada conversa e passa pro humano na hora certa.',
  },
  { property: 'og:title', content: 'Hermes' },
  { property: 'og:description', content: 'O atendente de WhatsApp que lembra de cada cliente.' },
  { property: 'og:type', content: 'website' },
  { property: 'og:image', content: '/brand/og.png' },
  { property: 'og:image:width', content: '1200' },
  { property: 'og:image:height', content: '630' },
  { name: 'twitter:card', content: 'summary_large_image' },
  { name: 'twitter:image', content: '/brand/og.png' },
]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const is404 = isRouteErrorResponse(error) && error.status === 404
  const title = is404 ? 'Página não encontrada' : 'Algo deu errado'
  const detail = is404
    ? 'A página que você procurou não existe ou foi movida.'
    : 'Tivemos um problema inesperado. Tente de novo em instantes.'

  // Stack só em desenvolvimento — nunca vaza detalhe técnico pro cliente em produção.
  const stack = import.meta.env.DEV && error instanceof Error ? error.stack : undefined

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 py-16 text-center text-ink">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-deep">
        <WingMark accent className="size-7 text-white" />
      </span>
      <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-soft">{detail}</p>
      <a
        href="/"
        className="mt-6 inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-deep"
      >
        Voltar ao início
      </a>
      {stack && (
        <pre className="mt-8 w-full max-w-2xl overflow-x-auto rounded-lg bg-surface p-4 text-left text-xs text-ink-soft">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
