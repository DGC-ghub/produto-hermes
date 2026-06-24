# Hermes

> **IA operacional para WhatsApp de pequenos negócios.** O dono descreve como a empresa
> funciona; a IA atende, qualifica, agenda, registra e chama um humano quando precisa —
> **sem ninguém desenhar fluxo.** Visão completa em [`docs/produto.md`](docs/produto.md).

Produto próprio da **DGC Hub**. Callbell *organiza* o atendimento, Devzapp *automatiza funil*
— o Hermes **opera** o atendimento por IA.

## Estado atual

Atendente de IA real rodando em ambiente **local/demo** (ainda **sem WhatsApp real**):

- **Cérebro IA plugável** — provider por env (`mock` | `claude_cli`); o `claude_cli` usa o
  Claude CLI logado, em modo headless e com coleira (sem ferramentas).
- **TenantConfig** — um motor, N configs: cada empresa é um `config/tenants/<slug>.json`
  (perfil, regras, objetivos, tools, guard-rails). O comportamento é código único.
- **Ações com isolamento** — a IA propõe (ex.: abrir chamado), o balcão valida e executa;
  cada contato só vê os próprios dados.
- **Handoff, leads e guard-rails** aplicados determinísticamente no balcão (nunca no prompt).
- **Transcrição de áudio local** (faster-whisper) — voz → texto converge no mesmo fluxo do
  atendente; motor isolado, sem reusar o agente pessoal da máquina.
- Empresas demo: `dgc`, `assistencia-tecnica-demo`, `prestacon`.

## Como rodar localmente

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

Banco em SQLite (`dev.db`, ignorado pelo git). O cérebro usa o provider `mock` por padrão;
para IA real, defina `ATTENDANT_PROVIDER=claude_cli` (requer o Claude CLI logado na máquina).

Para transcrição de áudio (opcional), crie o venv isolado uma vez:

```bash
bash scripts/setup-transcribe.sh   # requer uv + ffmpeg; venv não é versionado
```

## Rotas

```text
/           home
/demo/chat  simulador de conversa (lado do cliente)
/dashboard  painel read-only (lado da empresa)
```

## Documentos

- [`docs/produto.md`](docs/produto.md) — **spec de produto** (visão, categoria, roadmap).
- `docs/plano-fase-2-hermes-atendente.md` — o cérebro IA plugável.
- `docs/plano-demo-prestacon.md` — a demo com ações (chamados / agenda).
- `docs/plano-tenant-config.md` — o motor da parametrização.
- `docs/SECURITY-BACKLOG.md` — dívidas de segurança e regra de corte.

## Segurança

App **local/demo — não é produção.** Sem WhatsApp real e sem dados reais de cliente. Antes de
qualquer uso real: autenticação, autorização por tenant e identidade confiável do canal.
Detalhes em [`docs/SECURITY-BACKLOG.md`](docs/SECURITY-BACKLOG.md).

## Validações

```bash
npm run typecheck
npm test
npm run lint
npm run build
```
