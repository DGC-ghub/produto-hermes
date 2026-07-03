import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Banco de teste próprio e descartável (ver vitest.global-setup.ts) — a suíte
    // NUNCA pode encostar no dev.db, que no Pi é o banco do serviço em produção.
    env: {
      DATABASE_URL: `file:${path.join(process.cwd(), '.test.db')}`,
    },
    globalSetup: './vitest.global-setup.ts',
  },
})
