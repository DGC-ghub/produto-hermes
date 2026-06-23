# Prompt para Claude Code — Produto Hermes Task 11

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido em português simples:

Produto Hermes é uma plataforma para simular atendimento de WhatsApp por IA. Até agora já temos:

- `/demo/chat`: tela onde o usuário simula uma conversa;
- o Hermes responde usando a memória da empresa;
- conversas e mensagens são salvas no SQLite;
- quando precisa de humano, a conversa vira `needs_human` e cria `HandoffEvent`;
- tenants iniciais: `dgc` e `assistencia-tecnica-demo`.

Agora execute somente a Task 11 do plano:

```text
Task 11: Criar painel mínimo de leads/conversas
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 11:

Criar uma tela read-only em:

```text
/dashboard
```

Essa tela é o “lado da empresa”: onde Gabriel/DGC vê o que está acontecendo no simulador.

Em português simples: depois que `/demo/chat` gera conversas, o `/dashboard` mostra os números e a lista dessas conversas.

## Escopo exato desta task

Fazer:

1. Criar rota `/dashboard`.
2. Criar uma função server-side testável para buscar dados do painel.
3. Mostrar contadores:
   - total de conversas;
   - total de leads;
   - conversas que precisam humano;
   - total de mensagens, se for simples.
4. Mostrar últimas conversas.
5. Mostrar últimos leads, mesmo que esteja vazio por enquanto.
6. Criar links para abrir conversa no simulador `/demo/chat`.

Não fazer:

1. Não implementar extração de lead. Isso é Task 12.
2. Não criar/alterar schema Prisma nem migration.
3. Não alterar `/demo/chat` exceto se for absolutamente necessário para link/compatibilidade.
4. Não criar actions/formulários de escrita no dashboard.
5. Não implementar autenticação.
6. Não integrar WhatsApp real.
7. Não alterar o cérebro determinístico (`knowledge.server.ts`, `retrieval.ts`, `handoff.ts`, `response.ts`, `conversation.server.ts`).
8. Não alterar home/README agora. Isso é Task 13.
9. Não fazer commit nem push.

## Decisão importante sobre leads

A tabela `Lead` já existe, mas a Task 10 não cria lead. A extração de lead é Task 12.

Então, nesta Task 11:

- o painel deve ter seção de leads;
- se não houver leads, mostrar mensagem tipo `Nenhum lead ainda. A extração entra na Task 12.`;
- não criar leads falsos;
- não tentar extrair lead aqui.

## Arquivos esperados

Criar:

```text
app/lib/dashboard.server.ts
app/lib/dashboard.server.test.ts
app/routes/dashboard.tsx
```

Modificar:

```text
app/routes.ts
```

Também incluir o prompt no commit futuro:

```text
docs/prompts/2026-06-22-task-11-dashboard-minimo.md
```

## Parte 1 — Função server-side testável

Criar `app/lib/dashboard.server.ts`.

Contrato sugerido:

```ts
export type DashboardSummary = {
  totalConversations: number
  totalMessages: number
  totalLeads: number
  needsHumanConversations: number
}

export type DashboardConversation = {
  id: string
  tenantSlug: string
  tenantName: string
  contactId: string
  status: string
  messageCount: number
  lastMessagePreview: string | null
  updatedAt: string
}

export type DashboardLead = {
  id: string
  tenantSlug: string
  tenantName: string
  name: string | null
  phone: string | null
  neighborhood: string | null
  need: string | null
  urgency: string | null
  stage: string
  createdAt: string
}

export type DashboardData = {
  summary: DashboardSummary
  conversations: DashboardConversation[]
  leads: DashboardLead[]
}

export async function getDashboardData(): Promise<DashboardData>
```

Requisitos:

1. `getDashboardData` deve ser server-side e usar `db`.
2. Deve chamar `ensureInitialTenants()` no começo para garantir tenants iniciais.
3. `summary.totalConversations`: count de `Conversation`.
4. `summary.totalMessages`: count de `Message`.
5. `summary.totalLeads`: count de `Lead`.
6. `summary.needsHumanConversations`: count de `Conversation` com `status: 'needs_human'`.
7. `conversations`: últimas 20 conversas, ordenadas por `updatedAt desc`.
8. Cada conversa deve incluir tenant slug/name, contactId, status, messageCount e preview da última mensagem.
9. Preview da última mensagem:
   - pegar a mensagem mais recente da conversa;
   - truncar em até 120 caracteres;
   - se não tiver mensagem, `null`.
10. `leads`: últimos 20 leads, ordenados por `createdAt desc`, com tenant slug/name.

Observação:

Pode fazer queries simples mesmo que não sejam ultra otimizadas. MVP primeiro. Evitar overengineering.

## Parte 2 — Testes

Criar `app/lib/dashboard.server.test.ts`.

TDD aqui é viável porque a lógica de query fica separada da UI.

Teste vermelho:

```bash
npm test -- app/lib/dashboard.server.test.ts
```

Esperado inicialmente: falhar porque `dashboard.server.ts` ainda não existe.

Testes obrigatórios:

1. Com banco sem dados de teste, `getDashboardData()` retorna summary numérico e arrays.
2. Criando conversa/mensagens de teste, dashboard conta conversa e mensagens.
3. Criando conversa com `status: 'needs_human'`, dashboard incrementa `needsHumanConversations`.
4. Preview da última mensagem aparece truncado.
5. Se criar lead de teste manualmente no teste, dashboard lista lead.

Regras de limpeza dos testes:

- Use contactId de teste, por exemplo:

```text
test-task-11
```

- Criar dados de teste associados a um tenant existente, preferencialmente `dgc`.
- No cleanup, apagar apenas:
  - handoff events das conversas de teste;
  - messages das conversas de teste;
  - leads das conversas de teste ou com necessidade marcada do teste;
  - conversations com `contactId: 'test-task-11'`.
- Não apagar tenants reais.
- Não usar `deleteMany` amplo sem filtro.

## Parte 3 — Rota `/dashboard`

Criar `app/routes/dashboard.tsx`.

Registrar em `app/routes.ts`:

```ts
route('dashboard', 'routes/dashboard.tsx')
```

A rota deve ter:

### Loader

```ts
export async function loader() {
  return getDashboardData()
}
```

### UI mínima

A tela deve mostrar:

1. Título: `Produto Hermes — Dashboard`
2. Aviso: `MVP simulado — dados locais do SQLite.`
3. Cards simples com:
   - conversas;
   - mensagens;
   - leads;
   - precisam humano.
4. Seção `Conversas recentes`:
   - tenant;
   - contactId;
   - status;
   - preview da última mensagem;
   - link `Abrir no simulador` apontando para:

```text
/demo/chat?tenant=<tenantSlug>&conversationId=<conversationId>
```

5. Seção `Leads recentes`:
   - se vazio, mostrar: `Nenhum lead ainda. A extração entra na Task 12.`
   - se tiver dados, listar nome/telefone/bairro/necessidade/urgência/status.

Não precisa ficar bonito. Precisa ser claro e funcional.

## Parte 4 — Smoke manual

Depois das validações automáticas, se possível rode o app:

```bash
npm run dev -- --host 127.0.0.1
```

Acesse ou teste via curl:

```text
http://127.0.0.1:5173/dashboard
```

Critérios do smoke:

- GET `/dashboard` retorna 200;
- aparece o título `Produto Hermes — Dashboard`;
- aparecem os cards/contadores;
- aparece seção `Conversas recentes`;
- aparece seção `Leads recentes`.

Se já houver conversas geradas pela Task 10, o dashboard pode mostrar dados reais do dev.db. Se não houver, tudo bem mostrar zero/vazio.

Não deixe servidor rodando em background sem necessidade. Se usar background, finalize ou reporte o session id.

## Validações obrigatórias

Rodar:

```bash
npm test -- app/lib/dashboard.server.test.ts
npm run typecheck
npm test
npm run lint
npm run build
```

## Git status

No final, verificar:

```bash
git status --short
git status --ignored --short | sed -n '1,80p'
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
- teste vermelho inicial: PASS/FAIL/OBS
- npm test -- app/lib/dashboard.server.test.ts: PASS/FAIL
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL
- npm run build: PASS/FAIL
- smoke /dashboard: PASS/FAIL/NOT RUN + motivo

Comportamento implementado:
- summary counts
- conversas recentes
- preview última mensagem
- leads recentes/vazio
- links para /demo/chat
- UI /dashboard

Lead:
- criou extração de lead? NÃO esperado
- painel exibe leads existentes? SIM/NÃO
- painel lida com zero leads? SIM/NÃO

Banco local/git:
- .env/dev.db aparecem no git status normal? SIM/NÃO
- arquivos ignorados relevantes

Observações:
- ...

Próximo passo recomendado:
- Task 12: criar extração simples de lead
```

Lembrete: não commitar, não dar push, não implementar Task 12.
