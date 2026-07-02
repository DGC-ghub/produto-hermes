# Onboarding de colaborador — como contribuir no Hermes sem quebrar nada

> Bem-vindo. Este guia é o **cinto de segurança**: como rodar o projeto na sua
> máquina, o que você pode mexer à vontade, o que exige revisão e o que é
> **zona proibida** sem par. Se seguir isto, você pode "fritar" sem medo de
> cagar nas paradas — os testes te seguram, e o PR é a rede final.
>
> Contexto do produto e da stack: leia o `CLAUDE.md` da raiz primeiro (5 min).
> Este arquivo é só sobre **como trabalhar aqui com segurança**.

---

## O que é o Hermes em 4 linhas

Atendente de WhatsApp por IA, **multi-tenant** (uma base de código, vários
clientes). Cada empresa ("tenant") é dirigida por **dado**, não por código: um
JSON de config (`config/tenants/<slug>.json`) e uma pasta de conhecimento
(`knowledge/<slug>/`). Princípio sagrado: **a IA propõe (JSON), o código valida e
executa. A IA nunca toca o banco.** Os guard-rails (quando escalar pra humano, o
que não prometer) são **determinísticos no código** — nunca confiados ao prompt.

---

## Regra de ouro (as 2 camadas de segurança)

**Camada 1 — processo (inegociável):**
1. Você **nunca** commita direto na `main` nem na `feat/atendente-ia`.
2. Todo trabalho vive em **branch própria** e entra por **Pull Request**. O Gabriel revisa antes do merge.
3. Antes de dizer "pronto", os três checks passam **verdes**:
   ```bash
   npm run typecheck && npm test && npm run lint
   ```
   Isso é contrato, não sugestão. PR com check vermelho não entra.

**Camada 2 — zona de trabalho:** existe código que é núcleo sensível e código que
é periferia segura. A tabela de zonas (mais abaixo) diz onde você pode fritar e
onde você para e chama o Gabriel.

---

## Setup local isolado (rode na SUA cópia, nunca no serviço)

> ⚠️ **Atenção Pi:** na Raspberry roda um serviço `hermes.service` 24/7 servindo
> o app a partir de `~/projects/produto-hermes`. **Não trabalhe nesse diretório
> nem no banco dele.** Clone à parte. Como `.env` e `*.db` são gitignored, cada
> cópia tem o **próprio banco** (`prisma/dev.db`) e a **própria config** — então
> um clone separado já te isola naturalmente do serviço.

1. **Clone num diretório só seu** (na sua máquina ou na Pi, mas fora do dir do serviço):
   ```bash
   git clone <repo> ~/hermes-<seu-nome> && cd ~/hermes-<seu-nome>
   npm install
   ```
2. **Config local** — copie o exemplo e gere um segredo de sessão:
   ```bash
   cp .env.example .env
   node -e "console.log('SESSION_SECRET='+require('node:crypto').randomBytes(32).toString('hex'))"
   # cole o valor no .env; deixe ATTENDANT_PROVIDER="mock" pra começar
   ```
3. **Crie o SEU banco** (fica em `prisma/dev.db`, isolado e não versionado):
   ```bash
   npx prisma migrate dev
   ```
4. **Suba o projeto:**
   ```bash
   npm run dev
   ```
   Se estiver na Pi e der conflito de porta com o serviço que já roda, suba em
   outra porta (ex.: `npm run dev -- --port 3001`).

**Provider do cérebro (`ATTENDANT_PROVIDER`):**
- `mock` (default) — respostas determinísticas, **sem IA**. Use pra mexer em
  telas, config e fluxo. É o modo do dia a dia; não precisa de nada logado.
- `claude_cli` — IA real via Claude CLI logado na máquina. Só precisa disso pra
  rodar o **banco de provas** de verdade (`npm run eval:motor`). Mais lento.

**Ver o atendente conversando (simulador, sem login):**
`npm run dev` e abra `/demo/chat?tenant=<slug>` — ex.: `/demo/chat?tenant=prestacon`.
As telas internas (`/atendente`, `/dashboard`, `/configuracoes`) exigem login de
operador (criado sozinho na 1ª visita a `/login`, usuário = slug do tenant, senha
= `OPERATOR_SEED_PASSWORD` do seu `.env`).

---

## Zonas de trabalho — onde fritar e onde parar

| Zona | O que é | Arquivos típicos | Pode mexer? |
|------|---------|------------------|-------------|
| 🟢 **Livre** | Dado, conteúdo, docs, cenários de teste | `config/tenants/*.json`, `knowledge/**`, `docs/**`, cenários em `scripts/eval-motor.ts` | **Sim, à vontade** |
| 🟡 **Com revisão** | UI/telas e leituras de dado; toca banco mas é isolável | rotas em `app/routes/*.tsx`, componentes, `retrieval.ts`, `dashboard.server.ts`, `dossier.server.ts`, `ticket.ts`, `prisma/schema.prisma` | Sim, **mas PR revisado com calma** |
| 🔴 **Núcleo — não sozinho** | O cérebro e os guard-rails. Errar aqui quebra o produto | `conversation.server.ts`, `app/lib/attendant/**` (index, validate, rules, tenant-config), `handoff.ts`, `lead.ts`, `auth.server.ts`, `operators.server.ts`, `whatsapp.server.ts`, `webhook.whatsapp.tsx`, `tenants.server.ts` | **Pare e fale com o Gabriel** |

Regra prática: se o arquivo termina em `.server.ts` e está no `app/lib/`, **assuma
🔴/🟡 até confirmar**. Se é JSON de tenant, markdown de conhecimento ou doc, é 🟢.

> Por que o núcleo é intocável sozinho: ali mora a garantia de que a IA não
> promete o proibido, não vaza dado de outro cliente e escala pra humano quando
> deve. É pequeno de propósito (o `conversation.server.ts` tem ~330 linhas). O
> valor a construir agora está quase todo na periferia 🟢/🟡.

---

## Fluxo de uma tarefa (do zero ao PR)

1. **Pegue uma tarefa** em `docs/tarefas/` (veja o backlog no fim deste arquivo).
2. **Branch própria:** `git checkout -b feat/<seu-nome>-<tarefa>` (ex.: `feat/danilo-tenant-csmed`).
3. **Faça só o que a tarefa pede.** Se bater ambiguidade ou você precisar tocar
   uma zona 🔴, **pergunte antes de codar** — não improvise no núcleo.
4. **Escreva teste** pra qualquer lógica nova (`*.test.ts` ao lado do arquivo).
5. **Rode os três checks** e só siga com tudo verde:
   ```bash
   npm run typecheck && npm test && npm run lint
   ```
6. **Commits pequenos**, em [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`…).
7. **Abra o PR** contra a branch que o Gabriel indicar. No corpo do PR: o que fez
   em 2 linhas, como testou, e print/gif se for tela.

## Definição de "pronto" (a checklist do PR)

- [ ] Faz **só** o que a tarefa pediu (sem "aproveitei e mexi em X").
- [ ] Não toquei zona 🔴 sem combinar antes.
- [ ] `npm run typecheck` verde.
- [ ] `npm test` verde.
- [ ] `npm run lint` verde.
- [ ] Lógica nova tem teste.
- [ ] Segredo nenhum no código (tudo em `.env`; veja `.env.example`).
- [ ] PR explica em 2 linhas o que fez e como testou.

---

## Backlog de fritadas (por onde começar)

Tarefas fatiadas, isoladas e com critério de pronto, em ordem sugerida. Cada uma
mora em `docs/tarefas/`:

1. **[01] Novo tenant `csmed`** → `docs/tarefas/01-tenant-csmed.md`
   Criar uma vertical nova (CS MED — gestão de saúde / equipes médicas + home
   care) por config + conhecimento e validar no banco de provas. Zona 🟢 quase
   inteira. **Melhor primeira tarefa:** ensina o produto todo sem tocar o cérebro
   — e é um tenant com dono de verdade (a empresa da sua mãe).
2. **[02] Identidade visual "Mensageiro"** (a definir) — implementar as telas do
   `docs/design-system.md`. Zona 🟡 (front). Vistosa, isolável.
3. **[03] Expandir o banco de provas** (a definir) — mais cenários em
   `scripts/eval-motor.ts` cobrindo cantos que hoje faltam. Zona 🟢.

> Vertical alternativa/treino, se quiser praticar num caso mais simples antes:
> `docs/tarefas/backlog/tenant-condominio-demo.md` (condomínio/administradora,
> Arquétipo Chamado puro, sem a camada de risco de saúde).

Referências que você vai usar muito: `docs/playbook-replicacao-vertical.md` (o
manual de criar tenant) e `docs/verticais-alvo.md` (quais ramos encaixam e por quê).
