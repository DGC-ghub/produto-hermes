import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // jsdom fica só nos testes de encaixe React, que declaram `@vitest-environment jsdom`
    // no topo do arquivo. O resto da suíte segue em node — mais rápido, e é onde a lógica
    // pura vive.
    //
    // Worktrees ficam DENTRO do checkout (`.claude/worktrees/<nome>/`), e sem isto o vitest
    // varre a cópia junto: a suíte dobra de tamanho e as duas rodam contra o MESMO
    // `.test.db` (o `env` abaixo é resolvido por `process.cwd()`, que é igual para as duas).
    // O resultado é falha intermitente em quem escreve no banco, com aparência de bug do
    // código. Depender de `--exclude` na linha de comando não serve: `npm test` é o comando
    // do projeto e precisa passar sozinho.
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/.worktrees/**'],
    // Banco de teste próprio e descartável (ver vitest.global-setup.ts) — a suíte
    // NUNCA pode encostar no dev.db, que no Pi é o banco do serviço em produção.
    env: {
      DATABASE_URL: `file:${path.join(process.cwd(), '.test.db')}`,
    },
    globalSetup: './vitest.global-setup.ts',
  },
})
