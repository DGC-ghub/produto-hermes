-- Canal Baileys na fila (Passo 5): o WebhookEvent passa a carregar a origem do
-- evento. Aditivo (ADD COLUMN nullable) — não toca os eventos Meta existentes.
-- Null = evento da Meta (usa phoneNumberId). Preenchido = evento Baileys (a sessão
-- resolve o tenant; o messageId vem prefixado por sessão pra escopar o dedup).

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN "channelSessionId" TEXT;

-- CreateIndex
CREATE INDEX "WebhookEvent_channelSessionId_idx" ON "WebhookEvent"("channelSessionId");
