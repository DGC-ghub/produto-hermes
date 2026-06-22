# Prompt para Claude Code — Produto Hermes Task 10

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido em português simples:

Produto Hermes é uma plataforma para simular um atendimento de WhatsApp por IA. Até agora já temos:

- memória das empresas em `knowledge/`;
- função que abre essa memória;
- função que procura trechos relevantes;
- função que decide quando chamar humano;
- função que monta resposta segura;
- banco com tabelas de tenants, conversas, mensagens, leads e eventos de humano;
- helper para garantir os tenants `dgc` e `assistencia-tecnica-demo`.

Agora execute somente a Task 10 do plano:

```text
Task 10: Criar rota do simulador de conversa
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 10:

Criar a primeira tela funcional do Produto Hermes:

```text
/demo/chat
```

Nessa tela, Gabriel deve conseguir escolher uma empresa demo, digitar uma mensagem como se fosse cliente no WhatsApp, e ver o Hermes responder usando as peças já construídas.

Em português simples: essa task junta o cérebro + banco + tela mínima.

## Escopo exato desta task

Fazer:

1. Criar uma função server-side testável que processa mensagem recebida:
   - garante tenant;
   - cria ou reutiliza conversa;
   - salva mensagem do usuário;
   - carrega knowledge base;
   - faz retrieval;
   - decide se precisa humano;
   - compõe resposta;
   - salva resposta do Hermes;
   - se precisar humano, marca conversa como `needs_human` e cria `HandoffEvent`.

2. Criar rota `/demo/chat` com:
   - loader;
   - action;
   - UI mínima.

3. Registrar rota em `app/routes.ts`.

Não fazer:

1. Não implementar dashboard. Isso é Task 11.
2. Não implementar extração sofisticada de lead. Isso é Task 12.
3. Não criar/alterar schema Prisma nem migration.
4. Não integrar WhatsApp real.
5. Não chamar API de IA/LLM.
6. Não alterar `knowledge/`.
7. Não alterar `retrieval.ts`, `handoff.ts`, `response.ts`, `knowledge.server.ts` ou `tenants.server.ts`, exceto se houver bug real comprovado e explicado.
8. Não alterar home/README agora. Isso é Task 13.
9. Não fazer commit nem push.

## Decisão importante sobre lead nesta Task 10

O plano original menciona “extrair lead básico”, mas existe uma Task 12 específica para isso.

Então, nesta Task 10:

- NÃO implementar extração de lead avançada;
- NÃO tentar detectar nome/telefone/bairro/urgência;
- Opcionalmente pode criar um `Lead` mínimo somente quando a conversa precisar humano, com:

```ts
need: userMessage.slice(0, 180)
stage: 'novo'
```

Mas se isso complicar, deixe Lead para Task 12. Prioridade da Task 10 é conversa + mensagens + handoff + UI.

Se escolher criar lead mínimo, documente no relatório. Se escolher não criar, documente que ficou para Task 12.

## Arquivos esperados

Criar:

```text
app/lib/conversation.server.ts
app/lib/conversation.server.test.ts
app/routes/demo.chat.tsx
```

Modificar:

```text
app/routes.ts
```

Também incluir o prompt no commit futuro:

```text
docs/prompts/2026-06-22-task-10-simulador-conversa.md
```

## Parte 1 — Lógica testável server-side

Criar `app/lib/conversation.server.ts`.

Contrato sugerido:

```ts
export type ProcessIncomingMessageInput = {
  tenantSlug: string
  message: string
  conversationId?: string
  contactId?: string
}

export type ProcessIncomingMessageResult = {
  conversationId: string
  tenantSlug: string
  userMessageId: string
  assistantMessageId: string
  reply: string
  needsHuman: boolean
  handoffReason?: string
  confidence: number
  sources: Array<{
    fileName: string
    title: string
    score: number
  }>
}

export async function processIncomingMessage(
  input: ProcessIncomingMessageInput,
): Promise<ProcessIncomingMessageResult>
```

Regras da função:

1. Validar `message`:
   - trim;
   - se vazia, lançar erro com mensagem contendo `Message is required`.

2. Garantir tenant:
   - usar `ensureTenant` com nome correto se `tenantSlug` for `dgc` ou `assistencia-tecnica-demo`;
   - para slug desconhecido, pode lançar `Unknown tenant` ou garantir tenant com name=slug? Para MVP, prefira lançar `Unknown tenant` para evitar criar sujeira.

3. Conversa:
   - se `conversationId` vier, buscar conversa desse tenant;
   - se não existir ou pertencer a outro tenant, lançar `Conversation not found`;
   - se não vier, criar conversa com:

```ts
channel: 'simulator'
contactId: input.contactId ?? 'demo-user'
status: 'open'
```

4. Salvar mensagem do usuário:

```ts
role: 'user'
content: message
```

5. Carregar base:

```ts
loadKnowledgeBase(tenantSlug)
```

6. Buscar fontes:

```ts
retrieveRelevantChunks(message, docs)
```

7. Decidir humano:

```ts
decideHandoff({ message, retrievedCount: sources.length })
```

8. Compor resposta:

```ts
composeAssistantResponse({ tenantSlug, userMessage: message, sources })
```

9. Se `decideHandoff` disser `needsHuman`, a decisão final precisa marcar humano mesmo que `composeAssistantResponse` tenha `needsHuman: false`.

Para `requested_human` e `sensitive_topic`, usar uma resposta segura, por exemplo:

```text
Vou marcar para uma pessoa do time te ajudar com segurança. Pode me dar mais contexto enquanto isso?
```

Para `no_knowledge_match`, pode usar a resposta do `composeAssistantResponse` sem sources.

10. Salvar mensagem do assistente:

```ts
role: 'assistant'
content: reply
confidence
sourcesJson: JSON.stringify(sources resumidas)
```

11. Se precisa humano:

- atualizar conversa para:

```ts
status: 'needs_human'
```

- criar `HandoffEvent` com:

```ts
conversationId
reason: handoff.reason
message: userMessage
```

12. Se não precisa humano:

- manter ou atualizar conversa como `open`.

13. Retornar resultado com ids, resposta, flags e sources resumidas.

## Parte 2 — Testes

Criar `app/lib/conversation.server.test.ts`.

TDD aqui é possível na lógica server-side.

Teste vermelho:

```bash
npm test -- app/lib/conversation.server.test.ts
```

Esperado inicialmente: falhar porque `conversation.server.ts` ainda não existe.

Testes obrigatórios:

1. Cria conversa nova e salva mensagem do usuário + resposta do assistente.
2. Reutiliza conversa existente quando `conversationId` é informado.
3. Para pergunta normal da DGC, retorna `needsHuman: false` e sources não vazias.
4. Para mensagem “quero falar com humano”, retorna `needsHuman: true`, status da conversa vira `needs_human` e cria `HandoffEvent`.
5. Para mensagem sem match útil, retorna `needsHuman: true` com reason `no_knowledge_match`.
6. Rejeita mensagem vazia.
7. Rejeita tenant desconhecido.

Regras de limpeza dos testes:

- Use contactId de teste, por exemplo `test-task-10`.
- No cleanup, apague apenas conversas/mensagens/handoff/leads associadas a esse contactId ou tenant controlado.
- Não apagar tenants reais `dgc` e `assistencia-tecnica-demo`.
- Não usar deleteMany amplo sem filtro.

Sugestão de cleanup:

1. Buscar conversations com `contactId: 'test-task-10'`.
2. Apagar `HandoffEvent`, `Message`, `Lead`, `Conversation` desses IDs.
3. Não apagar tenants.

## Parte 3 — Rota `/demo/chat`

Criar `app/routes/demo.chat.tsx`.

Registrar em `app/routes.ts`:

```ts
route('demo/chat', 'routes/demo.chat.tsx')
```

A rota deve ter:

### Loader

- ler query param `tenant`;
- aceitar apenas:

```text
dgc
assistencia-tecnica-demo
```

- default: `dgc`;
- garantir tenants iniciais com `ensureInitialTenants()`;
- listar conversas recentes do tenant selecionado;
- se tiver `conversationId` na query, carregar mensagens dessa conversa;
- retornar dados simples para a UI.

### Action

Receber `FormData`:

```text
tenantSlug
message
conversationId? 
contactId?
```

Chamar:

```ts
processIncomingMessage(...)
```

Depois redirecionar para:

```text
/demo/chat?tenant=<tenantSlug>&conversationId=<conversationId>
```

Use APIs do React Router conforme padrão do projeto.

### UI mínima

A tela deve ter:

1. Título: `Produto Hermes — Simulador`
2. Aviso: `MVP simulado — sem WhatsApp real ainda.`
3. Seletor de tenant:
   - DGC Hub;
   - ResolveTech Assistência Demo.
4. Lista de conversas recentes.
5. Janela simples de mensagens.
6. Form com input/textarea de mensagem e botão enviar.
7. Badge quando conversa está `needs_human`.
8. Mostrar sources da última resposta se existirem em `sourcesJson`.

Não precisa ficar bonito. Precisa ser claro e funcional.

## Parte 4 — Smoke manual

Depois das validações automáticas, se possível rode o app:

```bash
npm run dev -- --host 127.0.0.1
```

Acesse ou teste via curl se viável:

```text
http://127.0.0.1:5173/demo/chat
```

Se não der para abrir visualmente, rode pelo menos `npm run build` como validação extra.

Não deixe servidor rodando em background sem necessidade. Se usar background, finalize ou reporte o session id.

## Validações obrigatórias

Rodar:

```bash
npm test -- app/lib/conversation.server.test.ts
npm run typecheck
npm test
npm run lint
npm run build
```

`npm run build` entra aqui porque agora temos rota real com loader/action/UI.

## Git status

No final, verificar:

```bash
git status --short
git status --ignored --short | sed -n '1,80p'
```

Confirmar:

- `.env` não aparece no status normal;
- `dev.db` não aparece no status normal;
- nenhum arquivo de build/cache entra como tracked.

## Relatório final obrigatório

Responder neste formato:

```text
Status: PASS / FAIL / BLOCKED

Arquivos alterados:
- ...

Validações:
- teste vermelho inicial: PASS/FAIL/OBS
- npm test -- app/lib/conversation.server.test.ts: PASS/FAIL
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL
- npm run build: PASS/FAIL
- smoke /demo/chat: PASS/FAIL/NOT RUN + motivo

Comportamento implementado:
- cria conversa
- reutiliza conversa
- salva mensagem do usuário
- salva resposta do Hermes
- retrieval + response
- handoff + HandoffEvent
- sourcesJson
- UI /demo/chat

Lead:
- criou lead mínimo? SIM/NÃO + motivo

Banco local/git:
- .env/dev.db aparecem no git status normal? SIM/NÃO
- arquivos ignorados relevantes

Observações:
- ...

Próximo passo recomendado:
- Task 11: criar painel mínimo de leads/conversas
```

Lembrete: não commitar, não dar push, não implementar Task 11.
