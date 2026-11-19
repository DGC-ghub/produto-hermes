-- CreateTable
CREATE TABLE "Cobranca" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "notaId" TEXT,
    "servicoChave" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'aguardando_pagamento',
    "pdfUrl" TEXT,
    "xmlUrl" TEXT,
    "motivo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Cobranca_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Cobranca_paymentId_key" ON "Cobranca"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Cobranca_notaId_key" ON "Cobranca"("notaId");
