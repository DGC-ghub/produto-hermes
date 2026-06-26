import { existsSync, readFileSync } from 'node:fs'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// HTTPS de desenvolvimento opcional: se os certificados locais existirem
// (gerados fora do git, ver scripts/setup-https.sh), o dev server sobe em HTTPS.
// Isso é o que libera o microfone do navegador (getUserMedia exige contexto
// seguro) ao acessar de outra máquina via Tailscale/LAN.
const KEY_PATH = 'certs/dev-key.pem'
const CERT_PATH = 'certs/dev-cert.pem'
const devHttps =
  existsSync(KEY_PATH) && existsSync(CERT_PATH)
    ? { key: readFileSync(KEY_PATH), cert: readFileSync(CERT_PATH) }
    : undefined

export default defineConfig(({ command, mode }) => {
  // Em dev, carrega o .env para o process.env do servidor (loaders/actions leem
  // de process.env). O shell tem precedência: `VAR=x npm run dev` continua valendo.
  // Sem isto, segredos como OPERATOR_PASSWORD/SESSION_SECRET não chegariam ao SSR.
  if (command === 'serve') {
    const env = loadEnv(mode, process.cwd(), '')
    for (const [key, value] of Object.entries(env)) {
      if (process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  }

  return {
    plugins: [tailwindcss(), reactRouter()],
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      host: true,
      // Libera acesso pelo nome do Tailscale (*.ts.net). IPs já são permitidos.
      allowedHosts: ['.ts.net'],
      ...(devHttps ? { https: devHttps } : {}),
    },
  }
})
