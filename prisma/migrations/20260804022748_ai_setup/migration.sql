-- AlterTable
ALTER TABLE "MessageTrace" ADD COLUMN "assistantMessageId" TEXT;
ALTER TABLE "MessageTrace" ADD COLUMN "executionMode" TEXT;
ALTER TABLE "MessageTrace" ADD COLUMN "setupGateEnforced" BOOLEAN;
ALTER TABLE "MessageTrace" ADD COLUMN "setupGateReason" TEXT;

-- CreateTable
CREATE TABLE "AiSetup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "publishedVersionId" TEXT,
    "reviewVersionId" TEXT,
    "activatedAt" DATETIME,
    "activatedById" TEXT,
    "grandfathered" BOOLEAN NOT NULL DEFAULT false,
    "grandfatheredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiSetup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiSetup_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "AiSetupVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AiSetup_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "AiSetupVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiSetupVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setupId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "origin" TEXT NOT NULL DEFAULT 'onboarding',
    "editRisk" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "basePublishedVersionId" TEXT,
    "rollbackSourceVersionId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "answersJson" TEXT NOT NULL,
    "submittedAt" DATETIME,
    "candidateConfigJson" TEXT,
    "candidateKnowledgeJson" TEXT,
    "summaryJson" TEXT,
    "gapsJson" TEXT,
    "risksJson" TEXT,
    "validationJson" TEXT,
    "validationResultsJson" TEXT,
    "reviewStartedAt" DATETIME,
    "reviewCompletedAt" DATETIME,
    "reviewer" TEXT,
    "reviewNote" TEXT,
    "changesRequested" INTEGER NOT NULL DEFAULT 0,
    "approvedByAccountId" TEXT,
    "approvedAt" DATETIME,
    "publishedAt" DATETIME,
    "supersededAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiSetupVersion_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "AiSetup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiSetupVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiSetupJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'generate',
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" DATETIME,
    "claimToken" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "failureKind" TEXT,
    "lastError" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiSetupJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AiSetupVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiSetupJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiSetupEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "versionId" TEXT,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiSetupEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiSetupEvent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AiSetupVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSetup_tenantId_key" ON "AiSetup"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSetup_publishedVersionId_key" ON "AiSetup"("publishedVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSetup_reviewVersionId_key" ON "AiSetup"("reviewVersionId");

-- CreateIndex
CREATE INDEX "AiSetupVersion_tenantId_state_idx" ON "AiSetupVersion"("tenantId", "state");

-- CreateIndex
CREATE INDEX "AiSetupVersion_setupId_createdAt_idx" ON "AiSetupVersion"("setupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiSetupJob_idempotencyKey_key" ON "AiSetupJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AiSetupJob_status_nextAttemptAt_idx" ON "AiSetupJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AiSetupEvent_tenantId_createdAt_idx" ON "AiSetupEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTrace_assistantMessageId_key" ON "MessageTrace"("assistantMessageId");

