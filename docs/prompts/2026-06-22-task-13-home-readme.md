# Prompt para Claude Code — Produto Hermes Task 13

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido em português simples:

Produto Hermes já tem o ciclo funcional do MVP simulado:

- cliente conversa em `/demo/chat`;
- Hermes responde usando a base de conhecimento;
- Hermes salva conversa e mensagens;
- Hermes extrai lead simples;
- DGC/empresa vê conversas e leads em `/dashboard`;
- há `docs/SECURITY-BACKLOG.md` dizendo claramente que o app ainda é local/simulado e não pode ir para produção com dados reais sem auth/segurança.

Agora execute somente a Task 13 do plano:

```text
Task 13: Atualizar home e README
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 13:

Deixar o projeto apresentável para abrir localmente.

Em português simples: a home não pode mais ser a tela padrão do template. Ela deve explicar o que é o Produto Hermes, apontar para `/demo/chat` e `/dashboard`, e deixar claro que é MVP simulado sem WhatsApp real.

## Escopo exato desta task

Fazer:

1. Atualizar `app/routes/home.tsx` para uma home real do Produto Hermes.
2. Atualizar `README.md` para refletir o estado atual do MVP.
3. Remover código morto do template se a home não usar mais `app/welcome/`.
4. Validar com typecheck, test, lint e build.
5. Fazer smoke da home (`/`) se possível.

Não fazer:

1. Não mexer em banco/schema/migration.
2. Não alterar `/demo/chat`.
3. Não alterar `/dashboard`.
4. Não alterar extração de lead.
5. Não implementar WhatsApp real.
6. Não implementar autenticação.
7. Não criar Task 14 agora.
8. Não fazer commit nem push.

## Decisão sobre código morto do template

Hoje `app/routes/home.tsx` importa:

```ts
import { Welcome } from '../welcome/welcome'
```

Depois da nova home, esse `Welcome` não será usado.

Então nesta Task 13:

- remover o import de `Welcome`;
- reescrever `home.tsx` completo;
- deletar a pasta `app/welcome/` se nada mais importar dela;
- confirmar com busca que não sobrou import/referência a `../welcome/welcome` ou `app/welcome`.

Se por algum motivo `app/welcome/` ainda for usado, explique no relatório. Mas a expectativa é deletar.

## Arquivos esperados

Modificar:

```text
app/routes/home.tsx
README.md
```

Possivelmente deletar:

```text
app/welcome/
```

Também incluir o prompt no commit futuro:

```text
docs/prompts/2026-06-22-task-13-home-readme.md
```

## Home esperada

`app/routes/home.tsx` deve:

1. Usar React Router `Link` para links internos.
2. Ter meta title/description corretos:

```text
Produto Hermes — MVP simulado
Simulador de atendimento com IA da DGC Hub
```

3. Mostrar claramente:

- título: `Produto Hermes`
- subtítulo: `MVP simulado de atendimento com IA para WhatsApp`
- aviso: `Sem WhatsApp real ainda — simulação local com SQLite.`

4. Ter dois links/botões principais:

```text
Abrir simulador -> /demo/chat
Ver dashboard -> /dashboard
```

5. Explicar em cards ou seções simples:

- o que já funciona:
  - memória por empresa;
  - busca de trechos relevantes;
  - resposta com guardrails;
  - chamada para humano;
  - persistência de conversas/mensagens;
  - extração simples de leads;
  - dashboard read-only.

- empresas demo:
  - DGC Hub;
  - ResolveTech Assistência (Demo).

- fora do escopo do MVP:
  - WhatsApp real;
  - autenticação/produção;
  - billing/SaaS completo;
  - campanhas;
  - CRM completo.

6. Ter link textual para:

```text
/docs/plano-tecnico-mvp-simulado.md
/docs/SECURITY-BACKLOG.md
```

Observação: esses links podem ser relativos simples. Não precisa criar rota para docs. É só referência visual/markdown.

7. Não usar `db` ou qualquer código server-side na home.

A home pode ser simples, com Tailwind. Não precisa design perfeito.

## README esperado

Atualizar `README.md` para refletir o MVP atual.

Pode reescrever por completo.

Deve conter seções:

1. `# Produto Hermes`
2. `## O que é`
   - Produto próprio da DGC Hub;
   - MVP simulado de atendimento com IA para WhatsApp;
   - ainda sem WhatsApp real.

3. `## O que já funciona`
   - `/demo/chat`;
   - `/dashboard`;
   - knowledge base por empresa;
   - retrieval simples;
   - handoff humano;
   - extração simples de lead;
   - persistência SQLite.

4. `## Como rodar localmente`

Incluir comandos:

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

E avisar:

```text
O banco local usa SQLite em dev.db e é ignorado pelo git.
```

5. `## Rotas principais`

```text
/           home do produto
/demo/chat  simulador de conversa
/dashboard  painel read-only
```

6. `## Escopo do MVP simulado`

Explicar que é local, demo, para validar fluxo comercial/técnico antes de WhatsApp oficial.

7. `## Fora de escopo por enquanto`

Listar:

- WhatsApp real/API Meta;
- auth/produção;
- dados reais de clientes;
- CRM completo;
- campanhas;
- billing/SaaS completo.

8. `## Segurança`

Referenciar:

```text
docs/SECURITY-BACKLOG.md
```

Deixar claro:

```text
Não usar com dados reais antes de implementar autenticação, autorização por tenant e identidade confiável do canal.
```

9. `## Documentos úteis`

Referenciar:

```text
docs/plano-tecnico-mvp-simulado.md
docs/SECURITY-BACKLOG.md
docs/prompts/
knowledge/dgc/
knowledge/assistencia-tecnica-demo/
```

10. `## Validações`

Incluir:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Validações obrigatórias

Rodar:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Também verificar que não sobrou referência ao template Welcome:

```bash
# Use a ferramenta de busca disponível; não precisa usar grep.
# Procurar por: Welcome, ../welcome, app/welcome
```

Smoke se possível:

```bash
npm run dev -- --host 127.0.0.1
```

Acessar ou testar:

```text
http://127.0.0.1:5173/
```

Critérios do smoke:

- GET `/` retorna 200;
- aparece `Produto Hermes`;
- aparece `Abrir simulador`;
- aparece `Ver dashboard`;
- aparece `Sem WhatsApp real ainda`.

Não deixe servidor rodando em background sem necessidade. Se usar background, finalize ou reporte o session id.

## Git status

No final, verificar:

```bash
git status --short
git status --ignored --short | sed -n '1,120p'
```

Confirmar:

- `.env` não aparece no status normal;
- `dev.db` não aparece no status normal;
- `build/`, `generated/`, `.react-router/`, `node_modules/` não entram como tracked.

## Relatório final obrigatório

Responder neste formato:

```text
Status: PASS / FAIL / BLOCKED

Arquivos alterados:
- ...

Validações:
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL
- npm run build: PASS/FAIL
- busca por Welcome/app/welcome: PASS/FAIL
- smoke home /: PASS/FAIL/NOT RUN + motivo

Comportamento implementado:
- home Produto Hermes
- links /demo/chat e /dashboard
- aviso MVP simulado/sem WhatsApp real
- README atualizado
- remoção de código morto do template

Banco local/git:
- .env/dev.db aparecem no git status normal? SIM/NÃO
- arquivos ignorados relevantes

Observações:
- ...

Próximo passo recomendado:
- Task 14: criar notas da integração WhatsApp oficial
```

Lembrete: não commitar, não dar push, não implementar Task 14.
