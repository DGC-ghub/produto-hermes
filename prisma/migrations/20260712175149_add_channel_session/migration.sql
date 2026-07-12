-- Sessão de canal Baileys/QR por tenant (Bloco 1 do plano vendável v1 — canal
-- WhatsApp self-service). Aditivo: tabela NOVA, não toca nenhum dado existente.
-- O auth-state do Baileys vai CIFRADO em authStateEnc (crypto.server); status
-- governa o ciclo do socket (desconectado|pareando|conectado|derrubado).

-- CreateTable
CREATE TABLE "ChannelSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'baileys',
    "label" TEXT,
    "waNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'desconectado',
    "authStateEnc" TEXT,
    "lastConnAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChannelSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ChannelSession_tenantId_idx" ON "ChannelSession"("tenantId");

-- CreateIndex
CREATE INDEX "ChannelSession_status_idx" ON "ChannelSession"("status");
