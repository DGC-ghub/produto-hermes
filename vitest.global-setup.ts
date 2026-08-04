// Bancos DESCARTÁVEIS para a suíte. Aqui se cria o MOLDE (schema + WAL) uma vez; cada
// worker tira a própria cópia em vitest.setup-worker.ts.
//
// Nada disto pode encostar no dev.db: no Pi ele é o arquivo do serviço em produção, e um
// `npm test` contra ele podia drenar a fila do webhook com o cérebro mock e descartar
// mensagem de cliente real (achado alta da revisão adversarial de 2026-07-03).
//
// UM banco por worker, e não um compartilhado, porque o SQLite serializa escrita entre
// processos e o handler de "busy" NÃO é fila justa: com 4 workers escrevendo no mesmo
// arquivo, uma transação interativa pode passar 20 s sem conseguir a vez e morrer de
// timeout. Isso é artefato do harness — em produção o serviço é UM processo — e produzia
// vermelho intermitente em quem escreve muito (`version.server.test.ts`).
import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { TEST_DB_PREFIX } from './vitest.worker-db'

/** Molde: criado uma vez e copiado por worker. Nunca é usado como banco de teste direto. */
export const TEST_TEMPLATE_PATH = path.join(process.cwd(), `${TEST_DB_PREFIX}template.db`)

export function setup(): void {
  limpar()
  // Path ABSOLUTO de propósito: o Prisma CLI resolve URL relativa a partir do
  // schema.prisma (prisma/), o better-sqlite3 a partir do cwd — absoluto casa os dois.
  execFileSync('npx', ['prisma', 'db', 'push'], {
    env: { ...process.env, DATABASE_URL: `file:${TEST_TEMPLATE_PATH}` },
    stdio: 'pipe',
  })
  // WAL fica gravado no cabeçalho do arquivo, então a cópia já nasce em WAL. O checkpoint
  // é obrigatório antes de copiar: sem ele parte do schema fica no `-wal`, que não é
  // copiado junto, e o worker receberia um banco sem tabelas.
  execFileSync(
    'sqlite3',
    [TEST_TEMPLATE_PATH, 'PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE);'],
    { stdio: 'pipe' },
  )
}

export function teardown(): void {
  limpar()
}

/** Apaga o molde e todos os bancos por worker, com os arquivos auxiliares do WAL. */
function limpar(): void {
  for (const nome of readdirSync(process.cwd())) {
    if (nome.startsWith(TEST_DB_PREFIX) && /\.db(-journal|-wal|-shm)?$/.test(nome)) {
      rmSync(path.join(process.cwd(), nome), { force: true })
    }
  }
}
