# Plano — Demo Prestacon (atendente com ações: info + agenda + chamados)

> Status: **rascunho para validação do Gabriel**. Mexe no `schema.prisma` (2 tabelas
> novas) — só faço com o teu "pode ir". Continua em cima da Fase 2 (cérebro plugável).

## Objetivo

Uma demo nova, da empresa fictícia **Prestacon (contabilidade/serviços)**, mostrando o
atendente IA com "mãos": responde info pública, abre/consulta chamados e propõe
agendamento — **sem nunca vazar dado de um cliente para outro**.

## Decisões (alinhadas com o Gabriel)

- **Ramo:** contabilidade/serviços. Base = prazos, obrigações, serviços, como enviar documento.
- **Agendamento:** a IA **propõe e um humano confirma**. A IA nunca fecha agenda sozinha;
  ela sugere um horário livre e abre um **pedido** (status `pendente`).
- **Identidade:** por contato (`contactId`). A demo simula 2 clientes para provar o isolamento.

## Princípio de arquitetura (o coração)

**Leitura é injetada (já isolada); escrita é proposta.**

- **Ler** (info pública, *meus* chamados, horários livres) → o balcão monta no contexto,
  já filtrado por `contactId`. O Claude **nunca recebe** dados de outro cliente.
  Privacidade por construção: o que não está no contexto não vaza, nem por injection.
- **Escrever** (abrir chamado, pedir agendamento) → o Claude **propõe** a ação no JSON; o
  **balcão valida e executa** (com `contactId` do canal, não da mensagem). A IA não toca o banco.

## Modelos novos (schema.prisma)

```
model Ticket {
  id          String   @id @default(cuid())
  tenantId    String
  contactId   String          // dono do chamado — chave do isolamento
  subject     String
  description String
  category    String?          // ex: documento, guia, dúvida fiscal
  status      String   @default("aberto")   // aberto | em_andamento | resolvido
  createdAt   DateTime @default(now())
  tenant      Tenant   @relation(...)
}

model Appointment {
  id          String   @id @default(cuid())
  tenantId    String
  contactId   String
  requestedAt DateTime          // horário sugerido pelo atendente
  topic       String
  status      String   @default("pendente")  // pendente | confirmado | recusado
  createdAt   DateTime @default(now())
  tenant      Tenant   @relation(...)
}
```

## Mudanças no cérebro (app/lib/attendant)

- **AttendantInput** ganha: `availability` (próximos horários livres, sem nomes) e
  `myTickets` (chamados só deste contato). Montados pelo balcão, isolados.
- **AttendantOutput** ganha: `action` = `none | abrir_chamado | pedir_agendamento` + `actionData`.
  O `validate.ts` valida o tipo de ação e os campos (ação desconhecida → ignora/handoff).
- O balcão executa a ação: `abrir_chamado` cria Ticket(contactId); `pedir_agendamento` valida
  que o slot está na `availability` e cria Appointment(contactId, status=pendente).
- Isso vale para os dois providers — o `mock` propõe ações fake (testa o fluxo sem IA).

## Disponibilidade da agenda (determinística)

Horário de atendimento fixo (ex.: seg–sex, 9h/11h/14h/16h). O balcão gera os próximos N
slots, remove os que já têm Appointment (pendente/confirmado) — **sem expor de quem** — e
injeta só os livres. O atendente sugere um; vira pedido pendente.

## Faseamento (uma fatia por vez, valida antes da próxima)

- **D1 — Prestacon + base.** Tenant `prestacon` + `knowledge/prestacon/*.md` (info contábil).
  Testável: cliente pergunta prazo/serviço → IA responde. *(não mexe no schema)*
- **D2 — Chamados.** Tabela Ticket + ação `abrir_chamado` + injeção de `myTickets` isolada.
  Cliente abre e consulta os chamados dele. *(migration)*
- **D3 — Agenda.** Tabela Appointment + `availability` + ação `pedir_agendamento` (pendente).
  *(migration)*
- **D4 — Visão da empresa.** No `/dashboard`: chamados e pedidos de agendamento pendentes
  (a fila que o "humano confirma").

## O que a demo prova (roteiro)

1. Cliente A pergunta sobre prazo do DAS → IA responde da base.
2. Cliente A abre um chamado ("preciso da guia de novembro") → vira Ticket dele.
3. Cliente A pede reunião → IA sugere horário livre e abre pedido pendente.
4. **Cliente B** entra e pede "meus chamados" → vê só os DELE (nada do A). ← prova do isolamento.
5. Empresa abre o `/dashboard` → vê a fila de chamados e pedidos pra confirmar.

## Segurança / limites

- Isolamento por `contactId` é **determinístico no balcão**, nunca no prompt.
- Na demo o `contactId` vem do simulador (não confiável) — serve para demonstrar o mecanismo.
  Em produção, vem do canal autenticado (wa_id). Continua no `SECURITY-BACKLOG.md`.
- Ações são propostas pela IA e executadas/validadas pelo código; a IA não tem acesso ao banco.
