-- FU1: o WebhookEvent passa a guardar o jid ORIGINAL de entrada do Baileys
-- (`<lid>@lid` ou `<phone>@s.whatsapp.net`). O WhatsApp novo endereça por @lid
-- (número oculto) — responder aos dígitos reconstruídos vai pro vácuo. Guardado pra
-- o operador humano e pendências drenadas pós-restart responderem ao jid certo.
-- Aditivo (ADD COLUMN nullable) — null = evento Meta (usa contactId como wa_id).

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN "remoteJid" TEXT;
