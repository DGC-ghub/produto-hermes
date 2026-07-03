// Banco DESCARTÁVEL para a suíte: cria o schema num arquivo próprio e apaga no fim.
// Sem isto o vitest caía no default `file:./dev.db` do db.server.ts — o MESMO
// arquivo do serviço em produção no Pi: um `npm test` podia drenar a fila do
// webhook com o cérebro mock e descartar mensagem de cliente real (achado alta
// da revisão adversarial de 2026-07-03).
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'

export const TEST_DB_PATH = path.join(process.cwd(), '.test.db')
export const TEST_DATABASE_URL = `file:${TEST_DB_PATH}`

export function setup(): void {
  // Path ABSOLUTO de propósito: o Prisma CLI resolve URL relativa a partir do
  // schema.prisma (prisma/), o better-sqlite3 a partir do cwd — absoluto casa os dois.
  execFileSync('npx', ['prisma', 'db', 'push'], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  })
  // WAL: os workers do vitest escrevem em paralelo no mesmo arquivo — no modo
  // default (delete) isso vira SQLITE_BUSY e o drain da fila aborta no meio.
  execFileSync('sqlite3', [TEST_DB_PATH, 'PRAGMA journal_mode=WAL;'], { stdio: 'pipe' })
}

export function teardown(): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true })
  }
}
