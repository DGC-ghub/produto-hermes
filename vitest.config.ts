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
    // varre a cópia junto: a suíte dobra de tamanho e as duas rodam a mesma coisa duas
    // vezes. Depender de `--exclude` na linha de comando não serve: `npm test` é o comando
    // do projeto e precisa passar sozinho.
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/.worktrees/**'],
    // O default são 5 s por teste, e neste Pi (4 núcleos, 4 workers em paralelo) isso é
    // apertado demais para o que NÃO é lógica: montar uma árvore React em jsdom e importar
    // o Baileys (13 MB) passam de 5 s sob carga. Timeout apertado não pega bug, só produz
    // vermelho intermitente que ninguém investiga.
    testTimeout: 20_000,
    // Rede de segurança: o valor de verdade é definido POR WORKER em setupFiles (um banco
    // por processo). Este default existe só para que uma falha lá nunca deixe o
    // `db.server.ts` cair no default DELE, que é o dev.db — no Pi, o banco do serviço em
    // produção. Este caminho não tem schema: se a suíte cair nele, ela quebra alto, que é
    // o desfecho certo.
    env: {
      DATABASE_URL: `file:${path.join(process.cwd(), '.test-fallback-sem-schema.db')}`,
    },
    globalSetup: './vitest.global-setup.ts',
    setupFiles: ['./vitest.setup-worker.ts'],
  },
})
