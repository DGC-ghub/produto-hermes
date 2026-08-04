import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // jsdom fica só nos testes de encaixe React, que declaram `@vitest-environment jsdom`
    // no topo do arquivo. O resto da suíte segue em node — mais rápido, e é onde a lógica
    // pura vive.
    // Banco de teste próprio e descartável (ver vitest.global-setup.ts) — a suíte
    // NUNCA pode encostar no dev.db, que no Pi é o banco do serviço em produção.
    env: {
      DATABASE_URL: `file:${path.join(process.cwd(), '.test.db')}`,
    },
    globalSetup: './vitest.global-setup.ts',
  },
})
