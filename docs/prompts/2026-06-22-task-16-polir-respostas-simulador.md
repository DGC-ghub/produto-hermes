# Prompt para Claude Code — Produto Hermes Task 16

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido:

O MVP simulado foi encerrado, mas no teste real de navegador apareceu um problema de qualidade de resposta:

Mensagem do usuário:

```text
ola tudo bem
```

Resposta atual ruim:

```text
# Serviços e preços — ResolveTech Assistência ...
```

Ou seja: o Hermes está burro para conversa básica. Ele pega uma saudação simples, faz retrieval em documento errado e despeja markdown cru da base.

Outro exemplo observado:

```text
Minha geladeira parou hoje no Jardim América
```

A resposta funcionou melhor, mas ainda começa despejando markdown cru:

```text
# FAQ — ResolveTech Assistência ...
```

Objetivo desta task:

Corrigir a qualidade mínima das respostas do simulador sem adicionar LLM/API externa.

Em português simples:

- saudação deve responder como saudação;
- não deve virar lead;
- não deve buscar documento aleatório;
- resposta não pode despejar markdown cru (`#`, `>`, títulos inteiros etc.);
- problema real, como geladeira parou, continua funcionando e gerando lead.

## Escopo permitido

Pode alterar:

```text
app/lib/retrieval.ts
app/lib/retrieval.test.ts
app/lib/response.ts
app/lib/response.test.ts
app/lib/lead.ts
app/lib/lead.test.ts
app/lib/conversation.server.ts
app/lib/conversation.server.test.ts
```

Se achar melhor, pode criar uma função pura nova, por exemplo:

```text
app/lib/message-intent.ts
app/lib/message-intent.test.ts
```

Não alterar:

```text
prisma/schema.prisma
app/routes/demo.chat.tsx
app/routes/dashboard.tsx
app/routes/home.tsx
README.md
knowledge/
```

Não implementar:

- LLM/API externa;
- WhatsApp real;
- auth;
- nova UI;
- migration.

Não fazer commit/push.

## Requisitos de comportamento

### 1. Saudação simples

Mensagens como:

```text
ola
olá
oi
oi tudo bem
ola tudo bem
bom dia
boa tarde
boa noite
```

Devem gerar uma resposta curta e natural, por exemplo:

```text
Olá! Tudo bem. Me diga como posso te ajudar por aqui.
```

Para tenant assistência técnica, pode ser:

```text
Olá! Tudo bem. Me diga qual equipamento precisa de ajuda e o que aconteceu.
```

Para tenant DGC, pode ser:

```text
Olá! Tudo bem. Me diga qual processo ou problema você quer resolver.
```

Critérios:

- `needsHuman: false`;
- `confidence` baixa/média, por exemplo `0.5`;
- `sources: []`;
- não criar `HandoffEvent`;
- não criar `Lead`;
- não salvar markdown cru na resposta.

### 2. Mensagem sem intenção útil não deve bater em doc aleatório

Além de saudação, mensagens só sociais/fracas não devem acionar retrieval por palavra fraca.

Adicionar stopwords/tokens fracos ao retrieval, no mínimo:

```text
ola
olá
oi
tudo
bem
bom
boa
dia
tarde
noite
```

Se depois disso a query não tiver tokens úteis, retrieval deve retornar `[]`.

Mas cuidado: se for saudação, não deve virar `no_knowledge_match`; deve usar resposta de saudação.

### 3. Não despejar markdown cru

A resposta final do Hermes não deve começar com markdown bruto como:

```text
# FAQ
# Serviços e preços
> Empresa fictícia
## Qual o horário
```

Criar sanitização de snippet antes de compor resposta.

Regras mínimas:

- remover linhas que começam com `#`;
- remover `>` de blockquote;
- remover marcação markdown simples (`**`);
- colapsar espaços;
- manter conteúdo útil;
- truncar depois de sanitizar.

Exemplo:

Entrada:

```md
# FAQ — ResolveTech Assistência
> Empresa **fictícia** (demo).
## Quais bairros vocês atendem?
Atendemos: Centro, Jardim América...
```

Saída usada na resposta não deve conter `#`, `>`, `**`.

### 4. Lead não deve nascer de saudação

Hoje toda mensagem não vazia vira `need`. Isso fez sentido no MVP, mas no teste real ficou ruim.

Alterar `extractLeadPatch` para não retornar `need` quando a mensagem for só saudação/social/fraca.

Exemplos que devem retornar `{}`:

```text
oi
olá
tudo bem
ola tudo bem
bom dia
```

Exemplos que continuam gerando lead:

```text
Minha geladeira parou hoje no Jardim América
Preciso de orçamento para máquina de lavar
Ar-condicionado não funciona
```

### 5. Geladeira parou continua funcionando

Mensagem:

```text
Minha geladeira parou hoje no Jardim América
```

Deve continuar:

- criando conversa;
- salvando user/assistant messages;
- criando/upsert lead;
- `urgency: alta`;
- `neighborhood: Jardim América`;
- resposta sem markdown cru;
- sources não vazias;
- aparecer no dashboard depois.

## Sugestão técnica

Uma forma limpa:

1. Criar `app/lib/message-intent.ts` com:

```ts
export function isGreetingOnly(message: string): boolean
```

2. Usar em:

- `conversation.server.ts`: se greeting-only, responder direto e pular retrieval/lead/handoff;
- `lead.ts`: não criar patch para greeting-only;
- talvez `retrieval.ts`: stopwords fracas também.

3. Criar helper em `response.ts`:

```ts
export function composeGreetingResponse(tenantSlug: string): AssistantDecision
```

ou manter privado se mais simples.

Escolha a solução mais simples e testável.

## Testes obrigatórios

Adicionar/ajustar testes:

### lead.test.ts

- `extractLeadPatch('ola tudo bem')` retorna `{}`.
- `extractLeadPatch('bom dia')` retorna `{}`.
- `extractLeadPatch('Minha geladeira parou hoje no Jardim América')` continua retornando need/urgency/neighborhood.

### retrieval.test.ts

- `retrieveRelevantChunks('ola tudo bem', docs)` retorna `[]`.
- `retrieveRelevantChunks('oi bom dia', docs)` retorna `[]`.

### response.test.ts

- snippet markdown cru é sanitizado: resposta não contém `#`, `>`, `**`.
- resposta com source real continua citando informação útil.

### conversation.server.test.ts

- `processIncomingMessage({ tenantSlug: 'assistencia-tecnica-demo', message: 'ola tudo bem' })`:
  - salva user + assistant message;
  - assistant reply contém saudação natural;
  - `needsHuman: false`;
  - `sources.length === 0`;
  - não cria Lead;
  - não cria HandoffEvent.

- `Minha geladeira parou hoje no Jardim América` continua criando lead e resposta sem markdown cru.

## Validações obrigatórias

Rodar:

```bash
npm test -- app/lib/lead.test.ts
npm test -- app/lib/retrieval.test.ts
npm test -- app/lib/response.test.ts
npm test -- app/lib/conversation.server.test.ts
npm run typecheck
npm test
npm run lint
npm run build
```

## Smoke manual obrigatório

Depois de passar tudo, subir o app e testar no navegador ou curl:

1. `/demo/chat?tenant=assistencia-tecnica-demo`
2. Enviar:

```text
ola tudo bem
```

Esperado:

- resposta natural de saudação;
- sem markdown cru;
- sem fonte aleatória;
- dashboard não mostra lead criado só por essa saudação.

3. Enviar:

```text
Minha geladeira parou hoje no Jardim América
```

Esperado:

- resposta sem markdown cru;
- dashboard mostra lead com Jardim América e alta.

Limpar dados de smoke depois, usando contactId controlado se usar curl.

## Relatório final obrigatório

Responder neste formato:

```text
Status: PASS / FAIL / BLOCKED

Arquivos alterados:
- ...

Validações:
- npm test -- app/lib/lead.test.ts: PASS/FAIL
- npm test -- app/lib/retrieval.test.ts: PASS/FAIL
- npm test -- app/lib/response.test.ts: PASS/FAIL
- npm test -- app/lib/conversation.server.test.ts: PASS/FAIL
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL
- npm run build: PASS/FAIL
- smoke saudação: PASS/FAIL
- smoke geladeira/lead: PASS/FAIL

Comportamento corrigido:
- saudação natural
- saudação não cria lead
- saudação não busca doc aleatório
- markdown cru removido da resposta
- geladeira/parou/Jardim América continua criando lead

Git:
- git status --short
- .env/dev.db aparecem no status normal? SIM/NÃO

Observações:
- ...
```
