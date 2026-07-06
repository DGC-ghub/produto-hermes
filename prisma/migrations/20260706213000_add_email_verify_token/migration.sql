-- AlterTable
ALTER TABLE "Account" ADD COLUMN "emailVerifyExpiresAt" DATETIME;
ALTER TABLE "Account" ADD COLUMN "emailVerifyToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Account_emailVerifyToken_key" ON "Account"("emailVerifyToken");
