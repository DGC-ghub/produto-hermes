import type { Config } from '@react-router/dev/config'

// Atrás de um proxy HTTPS (TLS terminado no proxy), o React Router 8.3+ rejeita
// POST de formulário com `Origin: https://...`. Para liberar, defina no BUILD:
//   HERMES_ALLOWED_ACTION_ORIGINS="app.exemplo.com,*.exemplo.com"
// Sem a variável, o padrão seguro do React Router continua valendo.
const allowedActionOrigins = (process.env.HERMES_ALLOWED_ACTION_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  ...(allowedActionOrigins.length > 0 ? { allowedActionOrigins } : {}),
} satisfies Config
