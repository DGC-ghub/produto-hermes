import { defineConfig } from 'vitest/config'

// Config DEDICADO ao banco de provas do motor (scripts/eval-motor.ts). Fica FORA
// do `npm test` de propósito: chama o provider REAL (claude_cli), é lento e
// não-determinístico. Rode sob demanda: `npm run eval:motor`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/eval-motor.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Sequencial: cada cenário spawna o CLI; não vale a pena martelar em paralelo.
    fileParallelism: false,
  },
})
