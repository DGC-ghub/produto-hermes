import { db } from '../db.server'
import type { RegistroOptIn } from './optin'

// Acesso ao banco do opt-in (DGC-348). A regra de quem pode receber está em ./optin (pura).

export async function lerOptIn(tenantId: string, contactId: string): Promise<RegistroOptIn | null> {
  return db.contactOptIn.findUnique({
    where: { tenantId_contactId: { tenantId, contactId } },
    select: { status: true, askedAt: true, decidedAt: true },
  })
}

// A gravação (pergunta e decisão) é feita dentro da transação do motor, em conversation.server.ts.
