-- Guarda LGPD (DGC-91): prazo de retenção por empresa, padrão 90 dias.
ALTER TABLE "Tenant" ADD COLUMN "retentionDays" INTEGER NOT NULL DEFAULT 90;
