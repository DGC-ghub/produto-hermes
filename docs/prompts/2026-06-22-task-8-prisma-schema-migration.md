# Prompt para Claude Code — Produto Hermes Task 8

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido:

Produto Hermes é uma plataforma de atendimento WhatsApp por IA. Estamos construindo primeiro um MVP simulado, sem WhatsApp real ainda.

Já foram concluídas:

- Task 1: app inicializado com o template DGC TS.
- Task 2: base de conhecimento da DGC em `knowledge/dgc/`.
- Task 3: base de conhecimento da demo assistência técnica em `knowledge/assistencia-tecnica-demo/`.
- Task 4: loader server-side da base de conhecimento em `app/lib/knowledge.server.ts`, com `loadKnowledgeBase(tenantSlug)`.
- Task 5: retrieval determinístico em `app/lib/retrieval.ts`, com `retrieveRelevantChunks(query, docs)`.
- Task 6: política de handoff em `app/lib/handoff.ts`, com `decideHandoff({ message, retrievedCount })`.
- Task 7: compositor de resposta com guardrails em `app/lib/response.ts`, com `composeAssistantResponse(...)`.

Agora execute somente a Task 8 do plano:

```text
Task 8: Atualizar Prisma schema e criar migration
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 8:

Criar o modelo de banco de dados do MVP para que, nas próximas tasks, o Hermes possa salvar:

- empresas/clientes demo (`Tenant`);
- conversas (`Conversation`);
- mensagens (`Message`);
- leads (`Lead`);
- eventos de passagem para humano (`HandoffEvent`).

Em português simples: até a Task 7 o Hermes já “pensa”. A Task 8 prepara o banco para ele lembrar das conversas.

Regras importantes:

1. Execute somente a Task 8.
2. Não implemente rotas, chat, UI, dashboard, seed, helper de tenant ou lógica de conversa. Isso é Task 9+.
3. Não altere `knowledge/`.
4. Não altere `app/lib/knowledge.server.ts`, `retrieval.ts`, `handoff.ts` ou `response.ts`, exceto se o typecheck exigir ajuste real — explique se acontecer.
5. Não faça commit nem push.
6. Aqui TDD não é igual às tasks anteriores: schema/migration não tem “teste vermelho → verde”. O critério é migration limpa + Prisma Client gerado + validações passando.
7. O banco dev local não deve entrar no commit. Verifique que `prisma/dev.db` continua ignorado.
8. Commit futuro deve incluir apenas `prisma/schema.prisma`, a pasta nova em `prisma/migrations/...` e este prompt se tudo estiver OK.

Estado atual esperado:

`prisma/schema.prisma` ainda tem o model de exemplo `Note` do template.

Decisão para esta task:

- Remover o model `Note` do schema, porque ele é exemplo do template e não pertence ao Produto Hermes.
- Criar os modelos reais do MVP.

Modelos a colocar em `prisma/schema.prisma`:

```prisma
model Tenant {
  id        String   @id @default(cuid())
  slug      String   @unique
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  conversations Conversation[]
  leads         Lead[]
}

model Conversation {
  id        String   @id @default(cuid())
  tenantId  String
  channel   String   @default("simulator")
  contactId String
  status    String   @default("open") // open | needs_human | closed
  summary   String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenant        Tenant         @relation(fields: [tenantId], references: [id])
  messages      Message[]
  lead          Lead?
  handoffEvents HandoffEvent[]
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  role           String   // user | assistant | system
  content        String
  confidence     Float?
  sourcesJson    String?
  createdAt      DateTime @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id])
}

model Lead {
  id             String   @id @default(cuid())
  tenantId       String
  conversationId String?  @unique
  name           String?
  phone          String?
  neighborhood   String?
  need           String?
  urgency        String?
  stage          String   @default("novo")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenant       Tenant        @relation(fields: [tenantId], references: [id])
  conversation Conversation? @relation(fields: [conversationId], references: [id])
}

model HandoffEvent {
  id             String   @id @default(cuid())
  conversationId String
  reason         String
  message        String?
  createdAt      DateTime @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id])
}
```

Observações de modelagem:

- Usar `String` para status/role/stage/reason neste MVP. Não criar enums agora.
- `sourcesJson` fica como `String?` porque SQLite + Prisma simples; o app pode salvar JSON serializado depois.
- `Lead.conversationId` é `@unique` para modelar 1 conversa -> no máximo 1 lead.
- Não adicionar índices extras agora, a menos que Prisma exija. YAGNI.

Passos esperados:

1. Verificar estado inicial:

```bash
cd /home/pi/projects/produto-hermes
git status --short --branch
sed -n '1,220p' prisma/schema.prisma
```

2. Editar `prisma/schema.prisma`:

- manter `generator client` e `datasource db` como estão;
- remover `model Note`;
- adicionar os modelos acima.

3. Criar migration com nome fixo:

```bash
npx prisma migrate dev --name produto_hermes_mvp
```

Resultado esperado:

- Prisma aplica a migration no banco dev;
- Prisma Client é gerado;
- aparece uma pasta nova em `prisma/migrations/<timestamp>_produto_hermes_mvp/`.

4. Verificar o que foi alterado:

```bash
git status --short
find prisma/migrations -maxdepth 2 -type f | sort
```

Atenção:

- `prisma/dev.db` não deve aparecer no `git status`.
- Se aparecer algum arquivo de banco local, não adicionar ao commit e reportar.

5. Rodar validações:

```bash
npm run typecheck
npm test
npm run lint
```

6. Opcional, mas recomendado: validar schema Prisma:

```bash
npx prisma validate
```

No final, reporte:

```text
Status: PASS / FAIL / BLOCKED
Arquivos alterados:
- ...

Migration:
- nome da pasta criada em prisma/migrations/...
- resumo do SQL gerado

Validações:
- npx prisma migrate dev --name produto_hermes_mvp: PASS/FAIL
- npx prisma validate: PASS/FAIL/NOT RUN
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL

Banco local:
- prisma/dev.db apareceu no git status? SIM/NÃO

Observações:
- ...

Próximo passo recomendado:
- Task 9: criar seeds mínimos/helper de tenants `dgc` e `assistencia-tecnica-demo`
```

Lembrete: não commitar, não dar push, não implementar Task 9.
