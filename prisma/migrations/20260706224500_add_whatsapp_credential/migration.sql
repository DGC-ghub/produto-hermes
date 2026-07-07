-- Credenciais próprias de WhatsApp por tenant (M4.2), cifradas em repouso (AES-256-GCM,
-- AAD tenant:<id>). Aditivo e nullable: números existentes seguem no env global (fallback).
-- AlterTable
ALTER TABLE "WhatsappNumber" ADD COLUMN "accessTokenEnc" TEXT;
ALTER TABLE "WhatsappNumber" ADD COLUMN "appSecretEnc" TEXT;
