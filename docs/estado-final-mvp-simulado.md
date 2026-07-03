# Estado Final — MVP Simulado Produto Hermes

## Status

- **Resultado: PASS** — MVP simulado saudável, reconstruível localmente e pronto
  para demonstração.
- **Data/hora da validação:** 2026-06-22 23:01 (-03).
- **Commit base validado:** `73b7fa7` (`docs: add WhatsApp official integration notes`),
  `main` alinhada com `origin/main`.

## O que o MVP faz hoje

- **Home (`/`)** — apresentação real do produto, com links para o simulador e o
  dashboard e aviso de "MVP simulado / sem WhatsApp real".
- **Simulador (`/demo/chat`)** — o cliente escolhe a empresa, digita como no
  WhatsApp e vê o Hermes responder.
- **Dashboard (`/dashboard`)** — painel read-only com contadores, conversas
  recentes e leads.
- **Memória por empresa** — knowledge base em `knowledge/<empresa>/`.
- **Resposta com guardrails** — composição determinística a partir dos trechos
  encontrados, sem inventar fora das fontes.
- **Handoff humano** — escala para pessoa (pedido explícito, tema sensível ou
  sem match na base) e registra `HandoffEvent`.
- **Extração de lead** — necessidade, urgência e bairro a partir da mensagem.
- **Persistência SQLite** — conversas, mensagens, leads e eventos de handoff.

## Rotas validadas

- `/` — HTTP 200; contém `Produto Hermes`, `Abrir simulador`, `Ver dashboard`.
- `/demo/chat` — HTTP 200; contém `Produto Hermes — Simulador`,
  `MVP simulado — sem WhatsApp real ainda`, `DGC Hub` e `ResolveTech Assistência (Demo)`.
- `/dashboard` — HTTP 200; contém `Produto Hermes — Dashboard`,
  `Conversas recentes`, `Leads recentes`.

## Validações executadas

| Comando | Resultado |
| --- | --- |
| `npx prisma validate` | PASS (schema válido) |
| `npx prisma migrate status` | PASS (2 migrations aplicadas; "Database schema is up to date") |
| `npm run typecheck` | PASS |
| `npm test` | PASS (9 arquivos, 68 testes) |
| `npm run lint` | PASS (33 arquivos, sem erros) |
| `npm run build` | PASS |
| smoke rotas (`/`, `/demo/chat`, `/dashboard`) | PASS (todas 200, conteúdo esperado) |
| smoke conversa → lead → dashboard | PASS (lead com `Jardim América`, urgência `alta`, "geladeira parou hoje") |

Reconstrutibilidade local confirmada: `.env.example` traz
`DATABASE_URL="file:./dev.db"`; `prisma.config.ts` lê `process.env.DATABASE_URL`;
`app/db.server.ts` tem fallback `?? 'file:./dev.db'`. O fluxo de setup é
`npm install` → `cp .env.example .env` → `npx prisma migrate dev` → `npm run dev`.

O dado de smoke (`contactId = 'smoke-task-15'`) foi removido do `dev.db` ao final;
tenants reais (`dgc`, `assistencia-tecnica-demo`) preservados.

## Segurança e limites

- É um **MVP simulado / local**, para demonstração — **não é produção**.
- **Sem WhatsApp real** e **sem dados reais** de clientes.
- Pendentes antes de qualquer uso real: **autenticação**, **autorização por
  tenant** e **`contactId` confiável** vindo do canal autenticado.
- Detalhes e regra de corte em [`SECURITY-BACKLOG.md`](SECURITY-BACKLOG.md).

## Próximo passo após MVP simulado

1. Gravar uma **demo/vídeo** do fluxo (conversa → resposta → lead → painel).
2. Validar com **Gabriel/Danilo**.
3. Escolher um **piloto**.
4. Só então iniciar o **WhatsApp oficial**, seguindo
   [`whatsapp-oficial-notas.md`](whatsapp-oficial-notas.md) e o backlog de
   segurança.

## Observações

- Nenhum blocker encontrado durante a validação; nenhum arquivo de app precisou
  ser corrigido nesta task.
- `.env` e `dev.db` permanecem fora do git (apenas ignorados); `build/`,
  `generated/`, `.react-router/` e `node_modules/` não entram como tracked.
- O `git status` ao final contém apenas este documento e o prompt da Task 15 como
  untracked.
