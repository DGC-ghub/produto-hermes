# Produto Hermes

## O que é

Produto próprio da **DGC Hub**: um **MVP simulado** de atendimento com IA para
WhatsApp, voltado a pequenos negócios.

**Ainda não há WhatsApp real.** Por enquanto é um simulador local: você digita
como se fosse o cliente e vê o Hermes responder, escalar para humano e gerar
leads — tudo persistido em SQLite local.

## O que já funciona

- `/demo/chat` — simulador de conversa (o lado do cliente).
- `/dashboard` — painel read-only (o lado da empresa/DGC).
- Knowledge base por empresa (memória em `knowledge/<empresa>/`).
- Retrieval simples (busca determinística de trechos relevantes).
- Handoff humano (escala para pessoa quando precisa).
- Extração simples de lead (necessidade, urgência, bairro).
- Persistência em SQLite (conversas, mensagens, leads, eventos de handoff).

## Como rodar localmente

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

O banco local usa SQLite em `dev.db` e é ignorado pelo git.

## Rotas principais

```text
/           home do produto
/demo/chat  simulador de conversa
/dashboard  painel read-only
```

## Escopo do MVP simulado

É um app **local e de demonstração**, feito para validar o fluxo comercial e
técnico (conversa → resposta → handoff → lead → painel) **antes** de integrar o
WhatsApp oficial. Não é produção.

## Fora de escopo por enquanto

- WhatsApp real / API da Meta
- Autenticação / produção
- Dados reais de clientes
- CRM completo
- Campanhas
- Billing / SaaS completo

## Segurança

As dívidas de segurança conhecidas estão registradas em
[`docs/SECURITY-BACKLOG.md`](docs/SECURITY-BACKLOG.md).

**Não usar com dados reais antes de implementar autenticação, autorização por
tenant e identidade confiável do canal.**

## Documentos úteis

- `docs/plano-tecnico-mvp-simulado.md` — plano técnico do MVP.
- `docs/SECURITY-BACKLOG.md` — dívidas de segurança e regra de corte.
- `docs/prompts/` — prompts travados de cada task.
- `knowledge/dgc/` — base de conhecimento da DGC Hub.
- `knowledge/assistencia-tecnica-demo/` — base da empresa demo (ResolveTech).

## Validações

```bash
npm run typecheck
npm test
npm run lint
npm run build
```
