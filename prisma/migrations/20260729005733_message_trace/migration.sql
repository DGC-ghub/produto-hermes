-- CreateTable
CREATE TABLE "MessageTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'simulator',
    "provider" TEXT NOT NULL DEFAULT 'nenhum',
    "outcome" TEXT NOT NULL,
    "totalMs" REAL NOT NULL,
    "brainMs" REAL,
    "stepsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageTrace_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MessageTrace_createdAt_idx" ON "MessageTrace"("createdAt");

-- CreateIndex
CREATE INDEX "MessageTrace_tenantId_createdAt_idx" ON "MessageTrace"("tenantId", "createdAt");
