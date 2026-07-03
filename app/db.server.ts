import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/prisma/client.js'

const dbUrl = (process.env.DATABASE_URL ?? 'file:./dev.db').replace('file:', '')

declare global {
  var __db: PrismaClient | undefined
}

if (!global.__db) {
  const adapter = new PrismaBetterSqlite3({ url: dbUrl })
  global.__db = new PrismaClient({ adapter })
}

export const db: PrismaClient = global.__db
