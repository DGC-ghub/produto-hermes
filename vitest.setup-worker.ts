// Roda DENTRO de cada worker, antes de qualquer arquivo de teste — e antes, portanto, de
// `db.server.ts` ser importado, que é quando ele lê `DATABASE_URL` e abre a conexão.
//
// Cada worker recebe uma cópia própria do molde criado em vitest.global-setup.ts. Ver lá o
// porquê: um arquivo compartilhado entre 4 processos leva a inanição de escrita no SQLite,
// que não é uma condição de produção (o serviço é um processo só).
import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { TEST_TEMPLATE_PATH } from './vitest.global-setup'

// `pid` em vez de VITEST_WORKER_ID: é único por processo sem depender de variável do
// vitest continuar existindo com o mesmo nome na próxima versão.
const bancoDoWorker = path.join(process.cwd(), `.test-${process.pid}.db`)

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
