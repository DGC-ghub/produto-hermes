# Prompt para Claude Code — Produto Hermes Task 15

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido em português simples:

O Produto Hermes chegou ao fim do MVP simulado:

- `/`: home real e README atualizado;
- `/demo/chat`: simulador de conversa;
- `/dashboard`: painel read-only;
- conversa → resposta → lead → painel funciona localmente;
- docs de segurança e WhatsApp oficial existem.

Agora execute somente a Task 15 do plano:

```text
Task 15: Rodar validação completa
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 15:

Validar que o MVP simulado está saudável, reconstruível localmente e pronto para demonstração.

Em português simples: não é para criar feature. É para provar que está tudo verde e registrar o estado final.

## Escopo exato desta task

Fazer:

1. Rodar validações completas:
   - typecheck;
   - tests;
   - lint;
   - build.
2. Verificar rotas principais:
   - `/`;
   - `/demo/chat`;
   - `/dashboard`.
3. Validar que o banco local e `.env` continuam fora do git.
4. Validar que o projeto é reconstruível localmente com `.env.example` + Prisma migration.
5. Criar um documento de fechamento do MVP com checklist e resultado real.

Não fazer:

1. Não implementar feature nova.
2. Não alterar código de app sem necessidade real de corrigir blocker.
3. Não alterar schema/migration.
4. Não integrar WhatsApp real.
5. Não implementar auth.
6. Não mexer no SECURITY-BACKLOG para “resolver” dívidas.
7. Não fazer commit nem push.

## Arquivos esperados

Criar:

```text
docs/estado-final-mvp-simulado.md
```

Também incluir o prompt no commit futuro:

```text
docs/prompts/2026-06-22-task-15-validacao-final.md
```

Só altere outros arquivos se algum problema real bloquear a validação. Se acontecer, explique muito claramente.

## Ordem recomendada de validação

### 1. Verificar git inicial

Rodar:

```bash
git status --short --branch
git --no-pager log -5 --oneline --decorate
```

Esperado:

- working tree limpo antes da criação do doc/prompt;
- branch `main` alinhada com `origin/main`.

### 2. Verificar `.env.example`, Prisma e db.server

Confirmar:

- `.env.example` existe;
- contém `DATABASE_URL="file:./dev.db"`;
- `prisma.config.ts` lê `process.env.DATABASE_URL`;
- `app/db.server.ts` tem fallback compatível com `file:./dev.db`.

Não precisa alterar se estiver correto.

### 3. Validar Prisma

Rodar:

```bash
npx prisma validate
npx prisma migrate status
```

Se `migrate status` reclamar de ambiente local mas migrations estiverem aplicadas, reporte o erro real. Não inventar.

Não criar nova migration.

### 4. Rodar validações obrigatórias

Rodar exatamente:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Todos devem passar.

Se `npm run build` falhar, a Task 15 é FAIL/BLOCKED até corrigir ou explicar blocker real.

### 5. Smoke das rotas principais

Subir o app uma vez, de preferência em porta livre:

```bash
npm run dev -- --host 127.0.0.1 --port 3115
```

ou usar server buildado se preferir.

Testar com curl ou navegador:

```text
http://127.0.0.1:3115/
http://127.0.0.1:3115/demo/chat
http://127.0.0.1:3115/dashboard
```

Critérios:

`/`:

- HTTP 200;
- contém `Produto Hermes`;
- contém `Abrir simulador`;
- contém `Ver dashboard`.

`/demo/chat`:

- HTTP 200;
- contém `Produto Hermes — Simulador`;
- contém `MVP simulado — sem WhatsApp real ainda`;
- contém DGC Hub e ResolveTech.

`/dashboard`:

- HTTP 200;
- contém `Produto Hermes — Dashboard`;
- contém `Conversas recentes`;
- contém `Leads recentes`.

### 6. Smoke funcional conversa → lead → dashboard

Executar um fluxo mínimo, preferencialmente via curl, usando contactId controlado:

```text
smoke-task-15
```

Fluxo:

1. POST em `/demo/chat` para tenant `assistencia-tecnica-demo` com mensagem:

```text
Minha geladeira parou hoje no Jardim América
```

2. Confirmar redirect 302 para `/demo/chat?tenant=assistencia-tecnica-demo&conversationId=...`.
3. Abrir a conversa redirecionada e confirmar que há resposta do Hermes.
4. Abrir `/dashboard` e confirmar que aparece lead com:

```text
Jardim América
alta
Minha geladeira parou hoje
```

5. Limpar do dev.db apenas os dados criados com `contactId = 'smoke-task-15'`:
   - HandoffEvent dessas conversas;
   - Lead dessas conversas;
   - Message dessas conversas;
   - Conversation dessas conversas.

Não apagar tenants reais.

Se curl/form CSRF/React Router dificultar POST, pode fazer smoke funcional com navegador/manual e relatar. Não inventar.

### 7. Verificar git/ignorados final

Rodar:

```bash
git status --short
git status --ignored --short | sed -n '1,140p'
```

Confirmar:

- `.env` não aparece no status normal;
- `dev.db` não aparece no status normal;
- `build/`, `generated/`, `.react-router/`, `node_modules/` não entram como tracked;
- apenas `docs/estado-final-mvp-simulado.md` e o prompt da Task 15 devem estar como untracked, salvo correção real explicada.

## Documento de fechamento

Criar `docs/estado-final-mvp-simulado.md`.

Conteúdo obrigatório:

```md
# Estado Final — MVP Simulado Produto Hermes
```

Deve conter seções:

1. `## Status`
   - dizer se está PASS/BLOCKED;
   - data/hora local da validação;
   - commit base validado.

2. `## O que o MVP faz hoje`
   - home;
   - simulador;
   - dashboard;
   - memória por empresa;
   - resposta com guardrails;
   - handoff humano;
   - extração de lead;
   - persistência SQLite.

3. `## Rotas validadas`
   - `/`;
   - `/demo/chat`;
   - `/dashboard`.

4. `## Validações executadas`
   - listar comandos reais e resultado PASS/FAIL:

```text
npx prisma validate
npx prisma migrate status
npm run typecheck
npm test
npm run lint
npm run build
smoke rotas
smoke conversa → lead → dashboard
```

5. `## Segurança e limites`
   - reforçar que é MVP simulado/local;
   - sem WhatsApp real;
   - sem dados reais;
   - auth/tenant/contactId confiável ainda pendentes;
   - referenciar `docs/SECURITY-BACKLOG.md`.

6. `## Próximo passo após MVP simulado`
   - gravar demo/vídeo;
   - validar com Gabriel/Danilo;
   - escolher piloto;
   - só depois iniciar WhatsApp oficial seguindo `docs/whatsapp-oficial-notas.md`.

7. `## Observações`
   - qualquer ressalva real encontrada durante validação.

Não inventar resultado. O documento deve refletir a execução real da Task 15.

## Relatório final obrigatório

Responder neste formato:

```text
Status: PASS / FAIL / BLOCKED

Arquivos alterados:
- ...

Validações:
- git inicial: PASS/FAIL
- .env.example/Prisma/db.server: PASS/FAIL
- npx prisma validate: PASS/FAIL
- npx prisma migrate status: PASS/FAIL
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL
- npm run build: PASS/FAIL
- smoke /: PASS/FAIL
- smoke /demo/chat: PASS/FAIL
- smoke /dashboard: PASS/FAIL
- smoke conversa → lead → dashboard: PASS/FAIL/NOT RUN + motivo
- cleanup smoke: PASS/FAIL/NOT NEEDED

Resultado do MVP:
- home apresentável
- simulador funcional
- dashboard funcional
- lead no dashboard
- segurança documentada
- WhatsApp oficial documentado

Banco local/git:
- .env/dev.db aparecem no git status normal? SIM/NÃO
- arquivos ignorados relevantes
- git status --short final

Observações:
- ...

Próximo passo recomendado:
- Commitar documentação de fechamento e considerar MVP simulado encerrado.
```

Lembrete: não commitar, não dar push.
