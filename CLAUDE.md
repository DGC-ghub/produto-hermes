# CLAUDE.md — instruções pra IA neste projeto

Este projeto foi criado a partir do template **dgc-template-ts** da DGC Hub.
Você (IA: Claude Code / Codex / Hermes) deve seguir estes padrões ao gerar, revisar ou alterar código aqui.

## Dono do produto e protocolo de comunicação

Gabriel é o dono do produto e está desenvolvendo julgamento técnico enquanto constrói o Hermes com apoio de IA. Ele conhece fundamentos de faculdade, mas não deve ser tratado como se já dominasse arquitetura, TypeScript avançado, concorrência, banco ou segurança. Não confunda falta de vocabulário técnico com falta de autoridade sobre o produto.

### Responsabilidades

- **Gabriel decide produto:** comportamento visível, prioridade, limites de autonomia, risco aceitável, custo, privacidade, necessidade de aprovação humana e regras do negócio.
- **A IA decide ou recomenda técnica:** organização interna, padrões de código e alternativas reversíveis dentro da stack e da especificação atuais.
- Não transfira uma escolha técnica aberta para Gabriel sem antes traduzi-la e apresentar uma recomendação.
- Nunca invente uma preferência do dono. Se a escolha muda produto, custo, segurança, dados, contrato ou é difícil de reverter, pare e peça decisão.
- Push, deploy, migration em produção, exclusão de dados e outras ações externas/irreversíveis continuam exigindo autorização explícita.

### Formato obrigatório antes de detalhes técnicos

Toda proposta, revisão ou bloqueio deve começar com uma camada curta em português simples:

1. **O que está acontecendo** — qual comportamento ou etapa está sendo trabalhado.
2. **Problema e impacto** — o que pode acontecer na prática e por que importa.
3. **Gabriel precisa decidir?** — responda `sim` ou `não`.
4. **Recomendação** — o menor próximo passo seguro.
5. **Estado da etapa** — aprovada, corretivo pendente ou bloqueada.

Depois dessa camada, apresente os detalhes técnicos, arquivos, testes e evidências. Relatórios P0/P1, termos como CAS, transação, idempotência e invariante nunca devem aparecer sem tradução prática na primeira ocorrência.

### Como fazer perguntas

Se uma decisão de Gabriel for realmente necessária, pergunte uma coisa por vez e use:

- decisão concreta;
- consequência para cliente/produto;
- opções com riscos e custos;
- recomendação da IA e motivo;
- se é reversível;
- o que acontece se for adiada.

Se for apenas uma decisão técnica interna e reversível, escolha a opção mais simples e segura compatível com a arquitetura atual, registre a justificativa e proteja o comportamento com testes. Não faça perguntas do tipo “qual arquitetura você prefere?” sem dar contexto e recomendação.

### Execução, revisão e ensino

- Trabalhe uma etapa por vez e evite despejar várias decisões simultâneas.
- Antes de implementar, confirme comportamento e critério de aceite em linguagem simples.
- Para regra verificável, use RED → GREEN → REFACTOR e mostre evidência real.
- Revisão técnica deve terminar dizendo exatamente o que Gabriel faz agora. Quando houver corretivo, forneça um prompt curto e copiável para o agente executor.
- Explique pelo menos um conceito relevante ligado ao código atual, sem transformar a entrega em curso longo.
- Não esconda risco para simplificar e não use jargão como substituto de explicação.
- Gabriel não precisa validar cada linha para autorizar avanço: a IA executora apresenta evidências e a IA revisora verifica de forma independente.

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

## O motor do atendente (mapa rápido)
O fluxo de uma mensagem recebida vive em `app/lib/conversation.server.ts`
(`processIncomingMessage`): resolve a identidade do contato (reusa a conversa ativa por
`contactId`), monta contexto/regras do `TenantConfig`, chama o cérebro e persiste. Peças:
- `app/lib/attendant/` — o "cérebro" plugável. Provider por env `ATTENDANT_PROVIDER`
  (`mock` | `claude_cli`); a saída é **sempre validada** antes de usar (fallback seguro escala
  para humano).
- `app/lib/dossier.server.ts` — ficha consolidada do contato (`composeDossier`, puro) + a fila
  (`getHandoffQueue`). Alimenta a tela `/atendente`.
- `app/lib/ticket.ts` — dedup de chamados por similaridade de assunto (puro).
- `app/lib/handoff.ts` · `lead.ts` · `retrieval.ts` · `knowledge.server.ts` — guard-rails de
  escalação, lead determinístico, RAG lexical, base de conhecimento.
- Config por empresa: `config/tenants/<slug>.json` + base em `knowledge/<slug>/`.

Princípio: **a IA propõe (JSON), o balcão valida e executa.** A IA nunca toca o banco.
Guard-rails são determinísticos, no código — nunca confiados ao prompt.

## Telas internas e segredos
- Rotas internas (`/atendente`, `/dashboard`) exigem `await requireOperator(request)` no
  `loader` (gate em `app/lib/auth.server.ts`; login em `/login`).
- Env: `OPERATOR_PASSWORD` + `SESSION_SECRET` (gate), `ATTENDANT_PROVIDER`/`CLAUDE_MODEL`
  (cérebro). Em dev o `.env` é carregado no servidor pelo `vite.config.ts`. Veja `.env.example`.

## Como adicionar uma funcionalidade (o padrão)
1. Precisa guardar dado novo? Adicione um `model` em `prisma/schema.prisma` e rode `npx prisma migrate dev --name <nome>`.
2. Crie a rota em `app/routes/<nome>.tsx` com `loader`/`action` usando `db` de `~/db.server`.
3. Registre a rota em `app/routes.ts`.
4. Regra de negócio/lógica? Ponha em `app/lib/` com um teste `*.test.ts`.
5. Use `app/routes/notes.tsx` como exemplo do padrão.

## Regras de trabalho
- Faça **só a tarefa pedida**. Se houver ambiguidade de produto, risco, dados ou ação irreversível, pergunte no formato acima. Se for detalhe técnico interno e reversível, recomende ou adote o menor padrão seguro sem transferir a escolha aberta para Gabriel.
- Não adicione bibliotecas fora da stack sem perguntar.
- Escreva **teste** pra lógica nova. Antes de dizer "pronto", rode `npm run typecheck`, `npm test` e `npm run lint`.
- Explique em 2 linhas o que fez.
- Segredos vão em `.env` (nunca no código). Veja `.env.example`.
- Commits pequenos, em [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`…).

## Comandos
- `npm run dev` — roda o projeto local
- `npm run typecheck` · `npm test` · `npm run lint` — checagens
- `npm run build` — build de produção
- `npx prisma migrate dev --name <x>` — cria/atualiza o banco. **Depois rode `npx prisma generate`**: o client fica em `generated/prisma` (saída customizada) e NÃO regenera sozinho no migrate — sem isso o model novo chega `undefined` em runtime.
