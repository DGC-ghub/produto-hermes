import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/prisma/client.js'

const dbUrl = (process.env.DATABASE_URL ?? 'file:./dev.db').replace('file:', '')

declare global {
  var __db: PrismaClient | undefined
}

if (!global.__db) {
  // timeout = busy_timeout do SQLite (15s): sob escrita concorrente (webhook + provisionamento;
  // e workers de teste no mesmo .test.db) espera o lock liberar em vez de estourar SQLITE_BUSY.
  const adapter = new PrismaBetterSqlite3({ url: dbUrl, timeout: 15_000 })
  global.__db = new PrismaClient({ adapter })
}

export const db: PrismaClient = global.__db
