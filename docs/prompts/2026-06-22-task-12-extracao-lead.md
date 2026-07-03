# Prompt para Claude Code — Produto Hermes Task 12

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido em português simples:

Produto Hermes já tem:

- `/demo/chat`: o cliente conversa com o Hermes;
- `/dashboard`: a DGC vê conversas, mensagens e leads;
- banco com tabela `Lead`;
- hoje o dashboard mostra leads vazios porque ainda não extraímos lead das mensagens.

Agora execute somente a Task 12 do plano:

```text
Task 12: Criar extração simples de lead
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 12:

Criar uma função simples que olha a mensagem do usuário e extrai sinais básicos de lead:

- necessidade/problema;
- urgência;
- bairro;
- possivelmente equipamento, dentro do campo `need` ou como parte do texto.

Depois integrar isso ao fluxo do simulador, para que `/demo/chat` crie/atualize um `Lead` no banco e o `/dashboard` passe a mostrar leads reais.

Em português simples: quando alguém escreve “minha geladeira parou hoje no Jardim América”, o Hermes deve salvar isso como um lead para a DGC/empresa ver no painel.

## Escopo exato desta task

Fazer:

1. Criar lógica pura de extração de lead em `app/lib/lead.ts`.
2. Criar testes de unidade em `app/lib/lead.test.ts`.
3. Integrar essa extração em `app/lib/conversation.server.ts`.
4. Criar/atualizar `Lead` por conversa usando `upsert`, porque `Lead.conversationId` é `@unique`.
5. Garantir que o dashboard mostra lead após mensagem com sinais de lead.

Não fazer:

1. Não criar/alterar schema Prisma nem migration.
2. Não criar novos campos no banco.
3. Não implementar IA/LLM.
4. Não integrar WhatsApp real.
5. Não alterar UI do dashboard, salvo se for necessário para bug real.
6. Não alterar home/README.
7. Não implementar autenticação.
8. Não fazer commit nem push.

## Arquivos esperados

Criar:

```text
app/lib/lead.ts
app/lib/lead.test.ts
```

Modificar:

```text
app/lib/conversation.server.ts
app/lib/conversation.server.test.ts
```

Provavelmente não precisa modificar:

```text
app/routes/demo.chat.tsx
app/routes/dashboard.tsx
prisma/schema.prisma
```

Se modificar algum desses, explique por quê no relatório.

Também incluir o prompt no commit futuro:

```text
docs/prompts/2026-06-22-task-12-extracao-lead.md
```

## Parte 1 — Função pura de extração

Criar `app/lib/lead.ts`.

Contrato esperado:

```ts
export type LeadPatch = {
  need?: string
  urgency?: string
  neighborhood?: string
}

export function extractLeadPatch(message: string): LeadPatch
```

Regras:

1. `need`:
   - se a mensagem tiver conteúdo útil, usar a mensagem original com espaços colapsados;
   - truncar em até 180 caracteres;
   - não inventar necessidade;
   - se a mensagem estiver vazia ou só espaços, não retornar `need`.

2. `urgency`:
   - retornar `'alta'` se a mensagem contiver algum termo de urgência:

```text
urgente
hoje
agora
parou
não funciona
nao funciona
sem funcionar
```

   - normalizar acentos para detectar `não` e `nao`.
   - se não houver urgência, não retornar `urgency`.

3. `neighborhood`:
   - detectar bairros conhecidos da demo:

```text
Centro
Jardim América
Jardim Europa
Jardim Paulista
Vila Nova
Bela Vista
Parque das Flores
Santa Rosa
```

   - deve funcionar com e sem acento:

```text
Jardim América
Jardim America
```

   - também aceitar padrões simples:

```text
no Jardim América
em Jardim América
bairro Jardim América
sou do Jardim América
```

   - retornar o nome canônico com acento correto, por exemplo `Jardim América`.
   - se não detectar bairro, não retornar `neighborhood`.

4. Não tentar extrair telefone/nome nesta task.
5. Não inventar dado ausente.

Sugestão de funções privadas:

```ts
function normalizeText(value: string): string
function compactText(value: string): string
function detectNeighborhood(message: string): string | undefined
function detectUrgency(message: string): string | undefined
```

## Parte 2 — Testes da função pura

Criar `app/lib/lead.test.ts`.

TDD:

1. Criar o teste primeiro.
2. Rodar para falhar:

```bash
npm test -- app/lib/lead.test.ts
```

Esperado: falhar porque `lead.ts` ainda não existe.

Testes obrigatórios:

1. Detecta urgência alta com `hoje`, `agora`, `urgente`, `parou`, `não funciona`, `nao funciona`.
2. Detecta bairro `Jardim América` com acento e sem acento.
3. Detecta outros bairros da lista, pelo menos `Centro`, `Vila Nova`, `Bela Vista`.
4. Cria `need` com mensagem compactada.
5. Trunca `need` em 180 caracteres.
6. Não inventa bairro quando não existe.
7. Mensagem vazia retorna `{}` ou objeto sem campos.
8. Não extrai telefone/nome.

## Parte 3 — Integrar com processIncomingMessage

Modificar `app/lib/conversation.server.ts`.

Após salvar a mensagem do usuário e antes ou depois de compor a resposta, chamar:

```ts
const leadPatch = extractLeadPatch(message)
```

Se `leadPatch` tiver algum campo útil (`need`, `urgency`, `neighborhood`), criar/atualizar `Lead` por conversa:

```ts
db.lead.upsert({
  where: { conversationId },
  create: {
    tenantId: tenant.id,
    conversationId,
    ...leadPatch,
    stage: 'novo',
  },
  update: {
    ...leadPatch,
  },
})
```

Atenções:

1. `conversationId` em Lead é único, então tem que ser `upsert`, não `create` direto.
2. Não sobrescrever campos existentes com `undefined`.
3. Se uma mensagem nova não trouxer bairro, não apagar bairro anterior.
4. Se uma mensagem nova trouxer urgência, pode atualizar urgency para `alta`.
5. `need` pode atualizar para a mensagem mais recente com problema/necessidade.

Sugestão:

Criar helper privado em `conversation.server.ts` ou em `lead.ts` para remover `undefined`:

```ts
function hasLeadPatch(patch: LeadPatch): boolean
function compactLeadPatch(patch: LeadPatch): Partial<LeadPatch>
```

Pode exportar `hasLeadPatch` se for útil para testar, mas preferir comportamento público.

## Parte 4 — Atualizar testes de conversation

Modificar `app/lib/conversation.server.test.ts`.

Adicionar testes obrigatórios:

1. Mensagem:

```text
Minha geladeira parou hoje no Jardim América
```

com tenant `assistencia-tecnica-demo` deve criar um lead com:

```text
urgency: alta
neighborhood: Jardim América
need contendo geladeira/parou
```

2. Enviar segunda mensagem na mesma conversa não deve criar lead duplicado; deve atualizar o lead existente.

3. Mensagem sem dados úteis não deve criar lead? Aqui cuidado: se `need` for sempre mensagem útil, quase toda mensagem vira lead. Para o MVP, aceite criar lead quando tiver `need`, mas pelo menos teste que mensagem vazia é rejeitada antes de extrair.

Decisão para esta task:

- Pode criar lead para qualquer mensagem não vazia, porque `need` é a mensagem compactada.
- Isso é aceitável no MVP, já que o simulador é comercial e toda conversa pode virar oportunidade.
- Mas não inventar bairro/urgency se não detectar.

Atualizar cleanup dos testes para apagar leads das conversas de teste. Se já existir, manter.

## Parte 5 — Smoke manual

Depois das validações, se possível:

1. Rodar app.
2. Abrir `/demo/chat?tenant=assistencia-tecnica-demo`.
3. Enviar:

```text
Minha geladeira parou hoje no Jardim América
```

4. Abrir `/dashboard`.
5. Confirmar que apareceu lead com:

```text
urgência alta
bairro Jardim América
necessidade com geladeira/parou
```

Se não rodar visualmente, `npm run build` + testes bastam, mas reporte smoke como NOT RUN com motivo.

## Validações obrigatórias

Rodar:

```bash
npm test -- app/lib/lead.test.ts
npm test -- app/lib/conversation.server.test.ts
npm run typecheck
npm test
npm run lint
npm run build
```

## Git status

No final, verificar:

```bash
git status --short
git status --ignored --short | sed -n '1,100p'
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
- teste vermelho inicial lead: PASS/FAIL/OBS
- npm test -- app/lib/lead.test.ts: PASS/FAIL
- npm test -- app/lib/conversation.server.test.ts: PASS/FAIL
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL
- npm run build: PASS/FAIL
- smoke lead no dashboard: PASS/FAIL/NOT RUN + motivo

Comportamento implementado:
- extractLeadPatch need
- urgency alta
- neighborhood canônico
- sem inventar dados
- upsert de Lead por conversa
- não duplica lead
- dashboard passa a mostrar leads reais

Banco local/git:
- .env/dev.db aparecem no git status normal? SIM/NÃO
- arquivos ignorados relevantes

Observações:
- ...

Próximo passo recomendado:
- Task 13: atualizar home e README
```

Lembrete: não commitar, não dar push, não implementar Task 13.
