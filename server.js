// Servidor de PRODUÇÃO do Hermes. Serve o build (react-router build) por HTTPS,
// reusando os certs self-signed de dev — assim a topologia pública não muda:
// mesma porta, mesmo funnel (https+insecure://localhost:5173), cookie Secure e
// microfone da demo seguem funcionando. A única diferença pro dev server é que
// aqui NÃO há HMR: o comportamento é o do build congelado, imune a edição da
// working tree / git checkout ao vivo (bloqueio C3 do docs/plano-entrega-2026.md).
//
// Espelha a lógica do react-router-serve (express + @react-router/express +
// compression), só trocando app.listen por https.createServer. O .env é carregado
// pelo Node nativo (--env-file-if-exists no script `start`), então funciona igual
// pelo systemd ou por `npm start` no shell.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequestHandler } from '@react-router/express'
import compression from 'compression'
import express from 'express'

// React precisa de production pra carregar a versão certa; também é o que liga o
// cookie Secure em auth.server.ts (correto, já que servimos HTTPS).
process.env.NODE_ENV = process.env.NODE_ENV ?? 'production'

const BUILD_PATH = './build/server/index.js'
const build = await import(pathToFileURL(resolve(BUILD_PATH)).href)

const app = express()
app.disable('x-powered-by')
app.use(compression())
// Assets com hash no nome → cache imutável de 1 ano; resto do client → 1h.
app.use('/assets', express.static('build/client/assets', { immutable: true, maxAge: '1y' }))
app.use(express.static('build/client', { maxAge: '1h' }))
app.all('/{*splat}', createRequestHandler({ build, mode: process.env.NODE_ENV }))

const key = readFileSync('certs/dev-key.pem')
const cert = readFileSync('certs/dev-cert.pem')
const port = Number(process.env.PORT ?? 5173)

const server = createServer({ key, cert }, app)
server.listen(port, () => {
  console.log(`[hermes] produção (HTTPS, sem HMR) em https://localhost:${port}`)
})

// Encerramento limpo quando o systemd reinicia/para o serviço. Fecha os sockets Baileys
// ANTES de sair (flush do auth-state cifrado — senão um restart logo após o pareamento
// perde o registro do device e força novo QR). Guarda de 3s pra nunca travar o shutdown.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    // Hard-exit se o encerramento pendurar numa conexão keep-alive (ex.: o poll do QR da
    // tela /canais): sem isto o process.exit só viria no SIGKILL do systemd. unref() pra
    // não segurar o processo caso tudo feche antes (FU2).
    setTimeout(() => process.exit(0), 5000).unref()
    try {
      const shutdownChannels = globalThis.__hermesShutdownChannels
      if (shutdownChannels) {
        await Promise.race([shutdownChannels(), new Promise((r) => setTimeout(r, 3000))])
      }
    } catch {}
    server.closeAllConnections?.() // derruba keep-alives pra o server.close() completar
    server.close(() => process.exit(0))
  })
}
