# CLAUDE.md — instruções pra IA neste projeto

Este projeto foi criado a partir do template **dgc-template-ts** da DGC Hub.
Você (IA: Claude Code / Codex) deve seguir estes padrões ao gerar ou alterar código aqui.

## Stack (não troque sem perguntar)
- **React Router v8** (framework mode) — cada página é uma rota com `loader`/`action`/componente
- **React 19** + **Tailwind CSS v4** (estilo via classes)
- **TypeScript** em modo `strict`
- **Prisma** + **SQLite** (banco em arquivo no dev) — acesso a dados
- **Biome** — lint e formatação (NÃO use ESLint nem Prettier)
- **Vitest** — testes

## Onde fica cada coisa
- `app/routes/*.tsx` — uma rota = uma página. Exporta `loader` (ler dados), `action` (gravar dados) e o componente.
- `app/routes.ts` — registra as rotas.
- `app/db.server.ts` — o cliente do banco (Prisma). **Só use em código de servidor** (`loader`/`action`), nunca dentro do componente de tela.
- `app/lib/*.ts` — funções puras/utilitárias (cada uma com teste).
- `prisma/schema.prisma` — o modelo de dados (as "tabelas").

> Arquivos `*.server.ts` rodam só no servidor. Não importe `~/db.server` num componente.

## Como adicionar uma funcionalidade (o padrão)
1. Precisa guardar dado novo? Adicione um `model` em `prisma/schema.prisma` e rode `npx prisma migrate dev --name <nome>`.
2. Crie a rota em `app/routes/<nome>.tsx` com `loader`/`action` usando `db` de `~/db.server`.
3. Registre a rota em `app/routes.ts`.
4. Regra de negócio/lógica? Ponha em `app/lib/` com um teste `*.test.ts`.
5. Use `app/routes/notes.tsx` como exemplo do padrão.

## Regras de trabalho
- Faça **só a tarefa pedida**. Se algo estiver ambíguo, **pergunte antes** de codar.
- Não adicione bibliotecas fora da stack sem perguntar.
- Escreva **teste** pra lógica nova. Antes de dizer "pronto", rode `npm run typecheck`, `npm test` e `npm run lint`.
- Explique em 2 linhas o que fez.
- Segredos vão em `.env` (nunca no código). Veja `.env.example`.
- Commits pequenos, em [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`…).

## Comandos
- `npm run dev` — roda o projeto local
- `npm run typecheck` · `npm test` · `npm run lint` — checagens
- `npm run build` — build de produção
- `npx prisma migrate dev --name <x>` — cria/atualiza o banco
