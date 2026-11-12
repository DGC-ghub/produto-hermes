// Roda DENTRO de cada worker, antes de qualquer arquivo de teste — e antes, portanto, de
// `db.server.ts` ser importado, que é quando ele lê `DATABASE_URL` e abre a conexão.
//
// Cada worker recebe uma cópia própria do molde criado em vitest.global-setup.ts. Ver lá o
// porquê: um arquivo compartilhado entre workers leva a inanição de escrita no SQLite, que
// não é uma condição de produção (o serviço é um processo só).
import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { threadId } from 'node:worker_threads'
import { testDbDir, testTemplatePath } from './vitest.global-setup'
import { nomeDoBancoDoWorker } from './vitest.worker-db'

// `pid` E `threadId`: o primeiro distingue no pool `forks` (default), o segundo no pool
// `threads`, onde todas as threads compartilham o pid. Ver vitest.worker-db.ts.
const bancoDoWorker = path.join(testDbDir(), nomeDoBancoDoWorker(process.pid, threadId))

const TEST_TEMPLATE_PATH = testTemplatePath()

if (!existsSync(TEST_TEMPLATE_PATH)) {
  // Se o molde não está lá, algo quebrou no global setup. Parar aqui é obrigatório: seguir
  // adiante deixaria o `db.server.ts` cair no default dele, que é o banco de produção.
  throw new Error(
    `Molde de teste ausente em ${TEST_TEMPLATE_PATH}. Sem ele a suíte não tem banco próprio.`,
  )
}

if (!existsSync(bancoDoWorker)) {
  copyFileSync(TEST_TEMPLATE_PATH, bancoDoWorker)
}

process.env.DATABASE_URL = `file:${bancoDoWorker}`
