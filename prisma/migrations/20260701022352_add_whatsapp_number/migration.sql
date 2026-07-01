-- CreateTable
CREATE TABLE "WhatsappNumber" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phoneNumberId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsappNumber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappNumber_phoneNumberId_key" ON "WhatsappNumber"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsappNumber_tenantId_idx" ON "WhatsappNumber"("tenantId");
