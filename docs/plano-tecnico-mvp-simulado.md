# Produto Hermes — Plano Técnico do MVP Simulado

> **Para Hermes:** usar `subagent-driven-development` para implementar este plano tarefa por tarefa, com revisão de aderência ao plano e revisão de qualidade antes de avançar.

**Data:** 2026-06-22

**Goal:** transformar o Produto Hermes de briefing em uma demo funcional simulada de atendimento WhatsApp por IA, usando base de conhecimento da DGC e um fluxo vertical de assistência técnica/serviço residencial.

**Architecture:** começar sem API oficial do WhatsApp. O MVP usa um simulador web de conversa que passa mensagens por um pipeline server-side: ingestão da mensagem, retrieval na base de conhecimento, composição de resposta com guardrails, persistência da conversa/lead e marcação de handoff humano. O app deve nascer preparado para trocar o simulador por webhook WhatsApp oficial depois, sem reescrever a regra de negócio.

**Tech Stack:** basear no `DGC-ghub/dgc-template-ts`: React Router v8 framework mode, React 19, TypeScript strict, Tailwind CSS v4, Prisma + SQLite, Biome e Vitest.

---

## 0. Decisões de escopo

### Inclui no MVP simulado

- app web local usando o template DGC TS;
- simulador de conversa estilo WhatsApp;
- base de conhecimento em arquivos markdown;
- cliente dogfood `dgc`;
- cliente demo vertical `assistencia-tecnica-demo`;
- retrieval simples, determinístico e testável;
- resposta IA/assistente com guardrails;
- persistência de conversas, mensagens, leads e eventos de handoff;
- painel mínimo para ver conversas/leads;
- docs para futura integração WhatsApp oficial.

### Não inclui no MVP simulado

- WhatsApp real;
- campanhas/disparos;
- billing/assinatura;
- multi-tenant completo com isolamento de produção;
- inbox completa de equipe;
- CRM avançado;
- autenticação;
- deploy produção;
- LGPD jurídico final;
- promessa de atendimento 100% autônomo.

### Princípios

- IA > CRM > caixa de entrada > campanhas.
- Primeiro provar conversa e resposta útil.
- Não deixar a IA inventar preço, prazo, garantia ou política.
- Se a base não responder, pedir mais contexto ou marcar handoff.
- Todos os módulos de regra de negócio devem ter teste.
- Não adicionar bibliotecas fora do template sem aprovação.

---

## 1. Arquitetura alvo

```text
Simulador Web
  -> action /demo/chat
  -> Message Ingest
  -> Conversation Store
  -> Knowledge Loader
  -> Retrieval simples
  -> Response Composer com guardrails
  -> Handoff Policy
  -> Persistência Message/Lead/HandoffEvent
  -> UI atualizada
```

### Diretórios alvo

```text
app/
  db.server.ts
  lib/
    knowledge.server.ts
    knowledge.test.ts
    retrieval.ts
    retrieval.test.ts
    handoff.ts
    handoff.test.ts
    response.ts
    response.test.ts
    lead.ts
    lead.test.ts
  routes/
    home.tsx
    demo.chat.tsx
    dashboard.tsx
  routes.ts
knowledge/
  dgc/
    perfil_do_negocio.md
    faq.md
    precos_servicos.md
    tom_de_voz.md
    handoff.md
  assistencia-tecnica-demo/
    perfil_do_negocio.md
    faq.md
    servicos_precos.md
    politica_agendamento.md
    tom_de_voz.md
    handoff.md
prisma/
  schema.prisma
docs/
  plano-tecnico-mvp-simulado.md
  whatsapp-oficial-notas.md
```

---

## 2. Modelo de dados proposto

Arquivo: `prisma/schema.prisma`

Adicionar modelos:

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

  tenant Tenant @relation(fields: [tenantId], references: [id])
  messages Message[]
  lead     Lead?
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

  tenant       Tenant @relation(fields: [tenantId], references: [id])
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

Observação: usar `String` para `status`, `role`, `stage` no MVP para evitar overengineering. Enums podem vir depois.

---

## 3. Contratos internos

### KnowledgeDocument

Arquivo: `app/lib/knowledge.server.ts`

```ts
export type KnowledgeDocument = {
  tenantSlug: string;
  fileName: string;
  title: string;
  content: string;
};
```

### RetrievedChunk

Arquivo: `app/lib/retrieval.ts`

```ts
export type RetrievedChunk = {
  fileName: string;
  title: string;
  snippet: string;
  score: number;
};
```

### AssistantDecision

Arquivo: `app/lib/response.ts`

```ts
export type AssistantDecision = {
  reply: string;
  confidence: number;
  sources: RetrievedChunk[];
  needsHuman: boolean;
  handoffReason?: string;
};
```

---

## 4. Tarefas de implementação

### Task 1: Inicializar app pelo template DGC TS

**Objective:** trazer a base técnica React Router/Prisma/Vitest para dentro do `produto-hermes`.

**Files:**
- Copy from template: `dgc-template-ts/*`
- Preserve: `docs/briefing.md`, `docs/regra-de-negocio.md`, `docs/roadmap.md`, `docs/plano-tecnico-mvp-simulado.md`
- Modify: `package.json`
- Modify: `README.md` se não existir

**Step 1: Copiar template sem apagar docs existentes**

```bash
cd /home/pi/projects/produto-hermes
rsync -av --exclude .git --exclude docs /home/pi/projects/dgc-template-ts/ ./
```

**Step 2: Ajustar nome do pacote**

Em `package.json`, trocar:

```json
"name": "dgc-template-ts"
```

por:

```json
"name": "produto-hermes"
```

**Step 3: Instalar dependências**

```bash
npm install
```

**Expected:** instala sem erro e gera/atualiza `package-lock.json`.

**Step 4: Rodar baseline**

```bash
npm run typecheck
npm test
npm run lint
```

**Expected:** todos passam antes de alterar regra de negócio.

**Checkpoint:** não commitar sem autorização explícita de Gabriel. Reportar `git status --short`.

---

### Task 2: Criar base de conhecimento dogfood da DGC

**Objective:** criar arquivos markdown que o Hermes usará para atender leads da própria DGC.

**Files:**
- Create: `knowledge/dgc/perfil_do_negocio.md`
- Create: `knowledge/dgc/faq.md`
- Create: `knowledge/dgc/precos_servicos.md`
- Create: `knowledge/dgc/tom_de_voz.md`
- Create: `knowledge/dgc/handoff.md`

**Step 1: Criar `perfil_do_negocio.md`**

Conteúdo mínimo:

```md
# Perfil do negócio — DGC Hub

A DGC Hub é uma software house enxuta que cria sistemas internos, automações e dashboards operacionais para pequenos negócios.

Oferta principal: DGC Sprint Operacional.

A DGC começa com diagnóstico, escopo fechado e entrega curta. Não promete sistemas gigantes sem entender o processo.
```

**Step 2: Criar `faq.md`**

Incluir perguntas sobre:

- o que a DGC faz;
- como funciona diagnóstico;
- o que é Sprint Operacional;
- prazo típico;
- como pedir proposta.

**Step 3: Criar `precos_servicos.md`**

Usar faixas já definidas:

- Diagnóstico: R$ 300 a R$ 700;
- Sprint Lite: R$ 1.500 a R$ 3.000;
- Sprint Pro: R$ 3.500 a R$ 8.000;
- Manutenção: R$ 300 a R$ 1.500/mês.

**Step 4: Criar `tom_de_voz.md`**

Definir tom:

- direto;
- humano;
- sem promessa exagerada;
- sem jargão desnecessário;
- chama humano para proposta específica.

**Step 5: Criar `handoff.md`**

Listar casos de handoff:

- cliente pede humano;
- preço fechado;
- contrato;
- projeto fora do escopo;
- assunto jurídico/LGPD;
- IA não sabe responder.

**Verification:** arquivos existem e podem ser listados:

```bash
find knowledge/dgc -type f | sort
```

---

### Task 3: Criar base de conhecimento da demo vertical assistência técnica

**Objective:** criar a demo nichada para portfólio e vídeos curtos.

**Files:**
- Create: `knowledge/assistencia-tecnica-demo/perfil_do_negocio.md`
- Create: `knowledge/assistencia-tecnica-demo/faq.md`
- Create: `knowledge/assistencia-tecnica-demo/servicos_precos.md`
- Create: `knowledge/assistencia-tecnica-demo/politica_agendamento.md`
- Create: `knowledge/assistencia-tecnica-demo/tom_de_voz.md`
- Create: `knowledge/assistencia-tecnica-demo/handoff.md`

**Business fixture:** empresa fictícia `ResolveTech Assistência`.

**Step 1: Criar perfil**

Incluir:

- assistência técnica residencial fictícia;
- atende ar-condicionado, máquina de lavar e geladeira;
- coleta bairro, urgência, equipamento e descrição;
- agenda visita técnica.

**Step 2: Criar FAQ**

Perguntas:

- horário de atendimento;
- bairros atendidos;
- como funciona orçamento;
- prazo de visita;
- garantia;
- formas de pagamento.

**Step 3: Criar serviços/preços**

Usar faixas fictícias, com regra de não fechar preço final sem avaliação:

- visita técnica: exemplo R$ 80 a R$ 150 conforme bairro;
- manutenção preventiva ar-condicionado: exemplo a partir de R$ 180;
- orçamento final depende da avaliação.

**Step 4: Criar política de agendamento**

Coletar:

- nome;
- telefone;
- bairro;
- equipamento;
- problema;
- urgência;
- melhor horário.

**Verification:** rodar:

```bash
find knowledge/assistencia-tecnica-demo -type f | sort
```

---

### Task 4: Implementar loader da base de conhecimento

**Objective:** carregar documentos markdown por tenant de forma server-side e testável.

**Files:**
- Create: `app/lib/knowledge.server.ts`
- Test: `app/lib/knowledge.test.ts`

**Step 1: Escrever teste**

```ts
import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "./knowledge.server";

describe("loadKnowledgeBase", () => {
  it("loads markdown documents for a tenant", async () => {
    const docs = await loadKnowledgeBase("dgc");

    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]).toHaveProperty("tenantSlug", "dgc");
    expect(docs.some((doc) => doc.fileName === "faq.md")).toBe(true);
  });
});
```

**Step 2: Rodar teste para falhar**

```bash
npm test -- app/lib/knowledge.test.ts
```

**Expected:** falha porque `knowledge.server.ts` ainda não existe.

**Step 3: Implementar loader**

Requisitos:

- usar `node:fs/promises`;
- usar `node:path`;
- aceitar apenas slug seguro com regex `/^[a-z0-9-]+$/`;
- ler `knowledge/{tenantSlug}/*.md`;
- título = primeira linha `# ...` ou nome do arquivo;
- retornar array ordenado por `fileName`.

**Step 4: Rodar teste**

```bash
npm test -- app/lib/knowledge.test.ts
```

**Expected:** PASS.

---

### Task 5: Implementar retrieval simples e determinístico

**Objective:** escolher trechos relevantes da base sem depender ainda de embeddings/LLM.

**Files:**
- Create: `app/lib/retrieval.ts`
- Test: `app/lib/retrieval.test.ts`

**Step 1: Escrever testes**

Casos mínimos:

```ts
import { describe, expect, it } from "vitest";
import { retrieveRelevantChunks } from "./retrieval";

const docs = [
  { tenantSlug: "dgc", fileName: "faq.md", title: "FAQ", content: "Diagnóstico custa de R$ 300 a R$ 700." },
  { tenantSlug: "dgc", fileName: "tom.md", title: "Tom", content: "Responder de forma direta." },
];

describe("retrieveRelevantChunks", () => {
  it("returns chunks matching query terms", () => {
    const result = retrieveRelevantChunks("quanto custa o diagnóstico?", docs);
    expect(result[0]?.fileName).toBe("faq.md");
    expect(result[0]?.score).toBeGreaterThan(0);
  });

  it("returns empty when there is no useful match", () => {
    const result = retrieveRelevantChunks("banana espacial", docs);
    expect(result).toEqual([]);
  });
});
```

**Step 2: Implementar função**

Requisitos:

- normalizar minúsculas e remover acentos;
- tokenizar palavras com 3+ caracteres;
- remover stopwords básicas: `que`, `para`, `com`, `uma`, `como`, `qual`, `quanto`, `pela`, `pelo`, `dos`, `das`;
- score = quantidade de tokens da query presentes no conteúdo/título;
- retornar top 3;
- snippet até 500 chars.

**Step 3: Rodar teste**

```bash
npm test -- app/lib/retrieval.test.ts
```

**Expected:** PASS.

---

### Task 6: Implementar política de handoff

**Objective:** decidir quando a IA deve chamar humano.

**Files:**
- Create: `app/lib/handoff.ts`
- Test: `app/lib/handoff.test.ts`

**Step 1: Escrever testes**

Casos:

- cliente pede humano;
- retrieval vazio;
- mensagem fala de contrato/LGPD;
- mensagem comum com sources não chama humano.

**Step 2: Implementar função**

Contrato:

```ts
export type HandoffDecision = {
  needsHuman: boolean;
  reason?: string;
};

export function decideHandoff(input: {
  message: string;
  retrievedCount: number;
}): HandoffDecision;
```

Regras:

- se mensagem contém `humano`, `atendente`, `pessoa`, `falar com alguém` -> reason `requested_human`;
- se `retrievedCount === 0` -> reason `no_knowledge_match`;
- se contém `contrato`, `lgpd`, `jurídico`, `processo` -> reason `sensitive_topic`;
- caso contrário `needsHuman: false`.

**Step 3: Rodar teste**

```bash
npm test -- app/lib/handoff.test.ts
```

**Expected:** PASS.

---

### Task 7: Implementar compositor de resposta com guardrails

**Objective:** gerar resposta determinística no MVP sem inventar informação fora da base.

**Files:**
- Create: `app/lib/response.ts`
- Test: `app/lib/response.test.ts`

**Step 1: Escrever testes**

Casos:

- com sources, resposta cita informação encontrada;
- sem sources, resposta pede mais contexto e marca humano;
- com pedido de preço específico fora da base, não inventa valor final.

**Step 2: Implementar `composeAssistantResponse`**

Contrato:

```ts
export function composeAssistantResponse(input: {
  tenantSlug: string;
  userMessage: string;
  sources: RetrievedChunk[];
}): AssistantDecision;
```

Regras:

- se `sources.length === 0`, responder: `Não encontrei essa informação na base. Vou marcar para um humano te ajudar com segurança. Pode me dar mais contexto enquanto isso?`;
- se tem source, responder em tom humano e curto;
- incluir próximos passos quando detectar termos de agendamento/orçamento/problema;
- confidence = `Math.min(0.95, 0.45 + sources[0].score * 0.1)`;
- nunca usar frases como “garantido”, “certeza”, “100%”.

**Step 3: Rodar teste**

```bash
npm test -- app/lib/response.test.ts
```

**Expected:** PASS.

---

### Task 8: Atualizar Prisma schema e criar migration

**Objective:** persistir conversas, mensagens, leads e eventos de handoff.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/*_produto_hermes_mvp/`

**Step 1: Adicionar modelos**

Adicionar os modelos da seção 2.

**Step 2: Criar migration**

```bash
npx prisma migrate dev --name produto_hermes_mvp
```

**Expected:** migration criada e Prisma Client gerado.

**Step 3: Validar tipo**

```bash
npm run typecheck
```

**Expected:** PASS ou erros apenas se modelos ainda não usados corretamente.

---

### Task 9: Criar seeds mínimos de tenants

**Objective:** garantir tenants `dgc` e `assistencia-tecnica-demo` no banco dev.

**Files:**
- Create: `app/lib/tenant.server.ts`
- Test: `app/lib/tenant.test.ts` se viável com banco de teste; caso contrário documentar smoke manual.

**Step 1: Implementar helper**

Contrato:

```ts
export async function ensureTenant(input: { slug: string; name: string })
```

Usar `db.tenant.upsert`.

**Step 2: Usar nos loaders/actions que precisam de tenant**

Não criar seed script ainda se não for necessário. YAGNI.

---

### Task 10: Criar rota do simulador de conversa

**Objective:** permitir testar mensagens como se fossem WhatsApp, sem depender da Meta.

**Files:**
- Create: `app/routes/demo.chat.tsx`
- Modify: `app/routes.ts`

**Route:** `/demo/chat`

**Step 1: Loader**

Loader deve:

- garantir tenant `dgc` por padrão;
- aceitar query param `tenant=dgc|assistencia-tecnica-demo`;
- listar conversas recentes;
- retornar mensagens da conversa selecionada se `conversationId` existir.

**Step 2: Action**

Action deve:

1. receber `message`, `tenantSlug`, `conversationId?`, `contactId?`;
2. garantir tenant;
3. criar conversa se não existir;
4. salvar mensagem do usuário;
5. carregar knowledge base;
6. fazer retrieval;
7. compor resposta;
8. salvar resposta;
9. se handoff, atualizar conversa `needs_human` e criar `HandoffEvent`;
10. extrair lead básico se detectar bairro/problema/urgência.

**Step 3: UI**

Tela mínima:

- seletor de tenant demo;
- janela de mensagens;
- input de texto;
- botão enviar;
- badge se precisa humano;
- lista de sources usadas na última resposta.

**Verification:**

```bash
npm run dev
```

Abrir `/demo/chat` e testar:

- “quanto custa diagnóstico?” no tenant `dgc`;
- “minha geladeira parou, atende no Jardim América?” no tenant `assistencia-tecnica-demo`;
- “quero falar com humano”.

---

### Task 11: Criar painel mínimo de leads/conversas

**Objective:** dar visibilidade comercial para a demo.

**Files:**
- Create: `app/routes/dashboard.tsx`
- Modify: `app/routes.ts`

**Route:** `/dashboard`

**Loader:**

- total de conversas;
- total de leads;
- conversas `needs_human`;
- últimas 20 conversas;
- últimos 20 leads.

**UI:**

- cards simples;
- tabela de leads;
- tabela de conversas;
- link para abrir conversa no simulador.

**Verification:**

Após enviar mensagens no simulador, `/dashboard` deve mostrar contadores > 0.

---

### Task 12: Criar extração simples de lead

**Objective:** capturar dados úteis sem NLP complexo.

**Files:**
- Create: `app/lib/lead.ts`
- Test: `app/lib/lead.test.ts`

**Step 1: Testes**

Casos:

- detecta urgência quando mensagem contém `urgente`, `hoje`, `agora`;
- detecta necessidade/problema por mensagem inteira resumida;
- não inventa nome/telefone se não vier.

**Step 2: Implementar**

Contrato:

```ts
export type LeadPatch = {
  need?: string;
  urgency?: string;
  neighborhood?: string;
};

export function extractLeadPatch(message: string): LeadPatch;
```

Regra simples:

- `urgency = "alta"` se contém `urgente|hoje|agora|parou|não funciona`;
- `neighborhood` só detectar padrões `bairro X`, `no setor X`, `em X` com cuidado;
- `need` pode ser a mensagem truncada em 180 chars.

---

### Task 13: Atualizar home e README

**Objective:** deixar o projeto apresentável para abrir localmente.

**Files:**
- Modify: `app/routes/home.tsx`
- Modify: `README.md`

**Home deve mostrar:**

- o que é Produto Hermes;
- links para `/demo/chat` e `/dashboard`;
- aviso “MVP simulado — sem WhatsApp real ainda”.

**README deve conter:**

- objetivo;
- stack;
- como rodar;
- links docs;
- escopo do MVP;
- fora de escopo;
- próximo passo WhatsApp oficial.

---

### Task 14: Criar notas da integração WhatsApp oficial

**Objective:** registrar caminho futuro sem bloquear MVP.

**Files:**
- Create: `docs/whatsapp-oficial-notas.md`

Conteúdo:

- por que não usar API não-oficial;
- opções: Meta Cloud API direta ou provedor homologado;
- custos por conversa;
- webhook necessário;
- templates de mensagem;
- variáveis de ambiente futuras;
- riscos LGPD;
- critérios para iniciar integração real.

---

### Task 15: Rodar validação completa

**Objective:** garantir que a base está saudável.

**Commands:**

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

**Expected:** todos passam.

Se `npm run build` falhar por limitação de ambiente, registrar erro real e bloquear entrega até corrigir.

---

## 5. Critérios de aceite do MVP simulado

O MVP só está pronto quando:

- `/demo/chat` permite conversar com tenant `dgc`;
- `/demo/chat` permite conversar com tenant `assistencia-tecnica-demo`;
- resposta usa base de conhecimento e mostra sources;
- pergunta fora da base marca handoff humano;
- conversa e mensagens ficam salvas no SQLite;
- dashboard mostra conversas/leads;
- testes de retrieval, handoff, response e lead passam;
- `typecheck`, `test`, `lint` e `build` passam;
- README explica claramente que WhatsApp real está fora do MVP simulado.

---

## 6. Demonstração esperada

### Demo 1 — DGC dogfood

Mensagem:

```text
Oi, quero saber como funciona a Sprint Operacional da DGC e quanto custa.
```

Resultado esperado:

- Hermes explica diagnóstico/sprint;
- cita faixas de preço como faixa, não preço fechado;
- oferece encaminhar para humano se quiser proposta.

### Demo 2 — Assistência técnica

Mensagem:

```text
Minha geladeira parou hoje, vocês atendem no Jardim América?
```

Resultado esperado:

- Hermes pergunta/confirmar bairro, urgência, equipamento e descrição;
- explica que orçamento final depende de avaliação;
- salva lead com urgência alta;
- não inventa preço final.

### Demo 3 — Handoff

Mensagem:

```text
Quero falar com uma pessoa sobre contrato e LGPD.
```

Resultado esperado:

- Hermes marca `needs_human`;
- cria `HandoffEvent` com reason `requested_human` ou `sensitive_topic`;
- dashboard mostra conversa pendente.

---

## 7. Sequência depois do MVP simulado

1. Gravar vídeo curto da demo.
2. Criar carrossel mostrando antes/depois do atendimento manual.
3. Validar com Gabriel e Danilo.
4. Escolher provedor/API oficial WhatsApp.
5. Implementar webhook real reusando pipeline interno.
6. Só depois avaliar CRM/inbox mais completos.
