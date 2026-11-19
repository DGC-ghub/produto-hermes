-- CreateTable
CREATE TABLE "ContactOptIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT,
    "askedAt" DATETIME,
    "decidedAt" DATETIME,
    "sourceMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContactOptIn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactOptIn_tenantId_contactId_key" ON "ContactOptIn"("tenantId", "contactId");
