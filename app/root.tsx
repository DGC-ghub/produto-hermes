import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'

import type { Route } from './+types/root'
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
  let message = 'Oops!'
  let details = 'An unexpected error occurred.'
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Error'
    details =
      error.status === 404 ? 'The requested page could not be found.' : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
