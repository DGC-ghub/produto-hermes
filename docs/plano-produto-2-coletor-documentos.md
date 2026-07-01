# Plano — Produto #2: Coletor de Documentos

> **Segundo produto do Hermes.** Depois que o #1 (Atendente WhatsApp) estiver de pé
> com um cliente real, o #2 ataca a maior dor operacional de um escritório contábil:
> **cobrar documento do cliente**. Reusa o mesmo motor, o mesmo canal e o mesmo
> princípio ("a IA propõe, o balcão valida"); o trabalho novo está em três pontos —
> **receber mídia**, **um modelo de checklist/documento** e **um agendador de lembretes**.
>
> **Cliente-âncora:** Prestacon Contabilidade (já tem `config/tenants/prestacon.json`
> e `knowledge/prestacon/`).
>
> Ordem geral dos produtos: #1 Atendente → **#2 Coletor de documentos** → #3 Leitor de doc fiscal.

---

## 1. O problema (e o princípio)

Hoje a secretária/contador passa o mês inteiro perseguindo cliente no WhatsApp:
"manda a nota de serviço", "cadê o extrato", "faltou a guia". É trabalho manual,
repetitivo e **~80% do atrito** de um escritório. O #2 automatiza esse ciclo:
sabe o que cada cliente **deve** enviar por competência, pede com jeito, recebe o
arquivo, marca o que chegou, persegue o que falta e avisa o escritório ao completar.

**Princípio (o mesmo do #1, sem exceção):** o **QUE falta é uma query determinística**
sobre um checklist (código, não IA); a **IA só cuida da CONVERSA** — entender "já
mandei isso", pedir o que falta com cordialidade, sugerir a classificação do que
chegou. A IA **propõe JSON**, o balcão **valida contra a policy do tenant e executa**;
a IA **nunca toca o banco** nem decide sozinha se um documento conta como recebido.

---

## 2. O que REUSA vs. o que é NOVO

### Reusa (confirmado no código, não recomeçar)

- **Motor de orquestração** — `processIncomingMessage` (`app/lib/conversation.server.ts:65`)
  resolve tenant, reusa conversa por `contactId`, monta contexto, chama o cérebro,
  valida e persiste. O tipo de inbound (texto vs. documento) muda só o **conteúdo**
  que entra, não a orquestração.
- **Cérebro plugável + saída validada** — `app/lib/attendant/` (provider por
  `ATTENDANT_PROVIDER`), com `AttendantOutput` **sempre validado** em `validate.ts`
  antes de usar. Fallback seguro escala pra humano.
- **O ARCABOUÇO de ação validada** — o padrão "a IA propõe uma ação tipada, o balcão a
  valida antes de executar" (`validateAction` em `validate.ts:92`, que descarta ação
  inválida virando `null` sem derrubar a resposta inteira). **Atenção:** hoje esse
  arcabouço só conhece **uma** ação — ver a correção importante em §2-bis. Reusa-se o
  *formato* (ação parcelada, tool ligada por tenant via `ToolPolicy`), não um enum já
  extensível.
- **Dedup determinístico por constraint** — o Ticket usa dedup por similaridade de
  assunto livre (`hasDuplicateOpenTicket`/`subjectsAreSimilar`, `app/lib/ticket.ts`).
  Para o #2 **não** reusamos esse mecanismo lexical: o `documentType` é um valor
  canônico (enumerado), então o dedup do checklist é uma **constraint `@@unique` no
  schema** (§3), determinística e sem cálculo de similaridade.
- **Isolamento por `(tenantId, contactId)`** — todo model (Ticket, Lead, Conversation…)
  escopa por tenant; o `@@index([tenantId, contactId])` do Ticket é o molde exato
  pros models novos.
- **Config por empresa** — `TenantConfig` (`tenant-config.ts:28`) com `parseTenantConfig`
  validando estrutura. É onde entra a `documentPolicy` do #2 (mesmo padrão declarativo).
- **Dossiê + fila de handoff** — `composeDossier` / `getHandoffQueue`
  (`app/lib/dossier.server.ts`) alimentam `/atendente`. Documentos pendentes/recebidos
  viram mais um sinal de prioridade na mesma fila. **Atenção:** a fila lê o *último*
  `HandoffEvent` **pela conversa** (`dossier.server.ts:159,221`) — o que restringe como
  o aviso ao escritório pode ser emitido (ver §2-bis e §6).
- **Lead determinístico (sem LLM)** — `extractLeadPatch` (`app/lib/lead.ts:57`), funções
  puras com regex/listas. É o **molde de estilo** (função pura, sem LLM) pra
  `classifyDocumentType` — mas é código novo, não edição do de lead.
- **Canal WhatsApp** — `sendWhatsAppMessage`, `resolveTenantSlugByPhoneNumber` (via
  banco), webhook em `app/routes/webhook.whatsapp.tsx`. Contato vem do `wa_id` da Meta
  (não de form), fechando spoofing — o mesmo vale pro dono do documento.
- **Miolo pós-download da mídia (do áudio)** — `transcribeUploadedAudio`
  (`app/lib/audio/upload.server.ts:14`) faz, **depois que já tem o `File` em memória**,
  o padrão: validar tamanho (`MAX_AUDIO_BYTES=15MB`) e extensão, escrever em tmpdir
  isolado, processar. **Esse é o reuso barato.** Mas ver a correção em §2-bis: essa
  função **não** prova recebimento de mídia pelo webhook.

### Novo (o trabalho de verdade do #2)

- **Receber mídia no inbound.** `parseInboundMessages` (`whatsapp.server.ts:80`) filtra
  `msg?.type === 'text'` e **descarta document/image**. Precisa aceitar esses tipos e
  extrair o `media_id`.
- **Baixar mídia da Cloud API (em duas etapas).** Não existe função que baixa `media_id`
  do WhatsApp. Precisa de `downloadMediaFromWhatsApp(mediaId)`.
- **Persistir o arquivo + o registro.** Não há model de documento no Prisma; áudio é
  transcrito e o temp é apagado. Documento tem que **ficar** (disco isolado por tenant
  + linha no banco).
- **Model de checklist/pendência.** O coração do #2. Não existe tabela de "o que o
  cliente DEVE enviar". Sem isso não há "o que falta".
- **Classificar o tipo do documento.** Não há função `nota fiscal vs. extrato`. MVP:
  pattern-matching puro no nome/MIME + sugestão da IA validada pela policy do tenant.
- **Novas ações da IA — que exigem refactor, não plug.** Ver §2-bis.
- **Agendador de lembretes.** Não existe cron/fila/`setInterval`/dependência no projeto.
  "Perseguir o que falta" exige um mecanismo novo (ver §5b).

---

## 2-bis. Três correções de escopo (o plano antigo subestimava)

Estas três coisas o plano tratava como "incremento simples"; na verdade são refactor de
porte médio. Documentadas aqui pra não surpreender na execução.

### (a) A ação da IA NÃO é um enum extensível — é um único literal hardcoded

`AttendantAction` hoje é **um único tipo literal** (`types.ts:47-52`):

```ts
export type AttendantAction = {
  type: 'abrir_chamado'
  subject: string
  description: string
  category?: string
}
```

E `validateAction` (`validate.ts:93`) **hardcoda** `raw.type !== 'abrir_chamado'`,
retornando `null` pra qualquer outro `type`. Não há `documentType`, `requestItemId` nem
`deadline`. Portanto adicionar `registrar_documento`/`solicitar_documento` **não é
"parcelar mais um `case`"** — é:

1. Transformar `AttendantAction` numa **union discriminada por `type`**:
   ```ts
   type AttendantAction =
     | { type: 'abrir_chamado'; subject: string; description: string; category?: string }
     | { type: 'registrar_documento'; documentType: string; requestItemId?: string }
     | { type: 'solicitar_documento'; documentType: string; competencia?: string }
   ```
2. Reescrever `validateAction` como um **`switch (raw.type)`** com um validador por
   variante e limites via `ToolPolicy` (a tool tem que estar habilitada pro tenant, como
   `abrir_chamado` já é).
3. Estender o catálogo `ToolName` (`tenant-config.ts:15`) com as novas tools.
4. Atualizar o **prompt/schema do provider** (o que a IA é instruída a emitir) e os
   **testes de `validate.ts`**.

**Porte:** médio. É o item mais subestimado do plano antigo. Fica na Etapa 3.

### (b) A infra de áudio prova UPLOAD por formulário, não mídia inbound pela Meta

`transcribeUploadedAudio` recebe um `File` **já em memória** e é chamada **só** de
`app/routes/demo.chat.tsx:114` (o simulador). **Nenhuma mídia entra hoje pelo webhook da
Meta**; o áudio entra por upload de formulário na tela de demo. Logo:

- **O download em duas etapas da Cloud API NÃO EXISTE** (nem parcialmente). Precisa ser
  escrito do zero: `GET https://graph.facebook.com/{GRAPH_VERSION}/{media_id}` (com
  Bearer de `WHATSAPP_ACCESS_TOKEN`) devolve uma **URL temporária**; um **segundo GET**
  (também com Bearer) baixa o binário. Tratar: HTTP != 200, URL expirada, timeout,
  tamanho acima do limite antes de escrever.
- **O reuso real é só o miolo pós-download:** validar tamanho/MIME e escrever isolado.
  O parse de `type=document`/`image` no webhook e os dois GETs são **100% novos**.
- **A única opção que herda `transcribeUploadedAudio` quase igual** é a ponte (5a-B):
  operador sobe o arquivo por uma tela interna. Aí sim reusa o padrão de upload como
  está.

### (c) O aviso ao escritório via `HandoffEvent` é conversation-scoped, não "por contato"

`HandoffEvent` (`schema.prisma:104-112`) é **keyed por `conversationId`** com FK
**obrigatória** para `Conversation` e **não tem** `tenantId` nem `contactId`. Além disso,
o dossiê/`getHandoffQueue` leem o **último** `HandoffEvent` **pela conversa**
(`dossier.server.ts:159,221`). Consequências que quebram o desenho antigo:

- O **agendador** (que roda sem conversa ativa) **não consegue** emitir um aviso de
  "vencido/completo" direto via `HandoffEvent`.
- Se a conversa fechar, o aviso **some** da fila — contradizendo o "o documento segue o
  contato".

**Decisão a tomar e documentar (escolher uma, não afirmar reuso 1:1):**

- **(i) Reusar `HandoffEvent` aceitando que é conversation-scoped.** Antes de emitir,
  **resolver/abrir a conversa ativa** do contato (o mesmo `getOrCreate` que
  `processIncomingMessage` já faz) e amarrar o evento nela. Regra: o agendador **nunca**
  emite aviso sem uma conversa. Mais simples, reusa a fila como está.
- **(ii) Criar um sinal próprio de completude** por `(tenantId, contactId, competencia)`,
  fora do `HandoffEvent`, lido diretamente pelo dossiê. Mais fiel ao "segue o contato",
  mas é mais um caminho de leitura no dossiê.

**Recomendação:** começar com **(i)** (menor superfície, reusa a fila), e migrar pra
**(ii)** só se "aviso some quando a conversa fecha" virar problema real na operação.

---

## 3. Modelo de dados novo

Dois models, seguindo o isolamento `(tenantId, contactId)`. **Um item de checklist é UM
(o que deve chegar); documentos são MUITOS** (o cliente pode mandar 2 notas do mesmo mês).

### `DocumentRequestItem` — o que o cliente DEVE enviar (o checklist)

Uma linha por `(tenant, contato, competência, tipo de documento)`. É a fonte da verdade
do "o que falta". A query `status = 'pendente'` é 100% determinística.

| campo | tipo | nota |
|---|---|---|
| `id` | String @id | cuid |
| `tenantId` | String | isolamento |
| `contactId` | String | isolamento (wa_id do cliente) |
| `competencia` | String | `"2026-06"` (mês/ano) — normalizado |
| `documentType` | String | `nota_servico` \| `extrato_bancario` \| `guia` \| `folha` \| `comprovante` … (enum lógico por vertical) |
| `status` | String | `pendente` \| `recebido` \| `aprovado` \| `rejeitado` \| `vencido` |
| `dueAt` | DateTime? | prazo (ex.: dia 5 do mês seguinte) |
| `lastReminderSentAt` | DateTime? | pra não spammar |
| `reminderCount` | Int @default(0) | quantas vezes já pedimos |
| `receivedAt` | DateTime? | quando o 1º doc válido chegou |
| `createdAt` / `updatedAt` | DateTime | |

Índice: `@@index([tenantId, contactId, competencia])`.
**Dedup do checklist (único mecanismo):** `@@unique([tenantId, contactId, competencia, documentType])`.
Como `documentType` é canônico, isso basta — **não** há assunto textual livre, então o
dedup lexical do Ticket (`subjectsAreSimilar`) é **irrelevante** aqui e não é usado.

**Estados (transições determinísticas, no balcão):**
`pendente` → `recebido` (chegou arquivo) → `aprovado` (operador confere) ou `rejeitado`
(foto ruim / tipo errado, volta a caçar). `pendente` → `vencido` (passou de `dueAt`
sem receber; marcado pelo agendador).

### `Document` — o arquivo que chegou (1-para-muitos com o item)

| campo | tipo | nota |
|---|---|---|
| `id` | String @id | cuid |
| `tenantId` | String | isolamento |
| `contactId` | String | dono do arquivo (do `wa_id`, **nunca** de form, **nunca** default `demo-user` — ver §6/Etapa 6) |
| `requestItemId` | String? | link ao `DocumentRequestItem` (pode chegar avulso, fora de checklist) |
| `documentType` | String | classificação aplicada (proposta IA + validada) |
| `fileName` | String | nome original |
| `mimeType` | String | `application/pdf`, `image/jpeg`, `image/png`… |
| `fileSize` | Int | bytes |
| `filePath` | String | caminho isolado: `data/documents/<tenantId>/<contactId>/<id>.<ext>` |
| `status` | String | `novo` \| `processado` \| `rejeitado` |
| `metadata` | String? (JSON) | ex.: `rejectionReason`, page count |
| `uploadedAt` | DateTime @default(now) | |

Índices: `@@index([tenantId, contactId])`, `@@index([requestItemId])`.
`Document` amarra por `contactId` + `tenantId` (não por `conversationId`) — conversa é
fluida (fecha/reabre), o documento tem que seguir o contato.

---

## 4. Fluxo ponta a ponta

1. **Escritório define o checklist.** Via config (template por vertical, §7) + eventual
   ajuste por cliente. No início de cada competência, um passo gera os
   `DocumentRequestItem` (status `pendente`) daquele mês pra cada contato ativo.
2. **Hermes pede no WhatsApp.** Determinístico decide **o que** falta (query
   `status='pendente'`); a **IA redige o pedido** com o tom do tenant ("Oi! Pra fechar
   junho, você me manda a nota de serviço e o extrato?"). Envio por `sendWhatsAppMessage`.
3. **Cliente responde.** Dois caminhos:
   - **Manda arquivo** → webhook recebe `type=document/image` → baixa mídia (dois GETs)
     → grava `Document` em disco isolado + linha no banco.
   - **Responde em texto** ("já mandei isso semana passada", "esse mês não tive nota")
     → a IA interpreta e **propõe** ação (marcar como não-aplicável, pedir de novo) —
     o balcão valida contra a policy.
4. **Sistema classifica e marca recebido.** `classifyDocumentType` (puro, por nome/MIME)
   dá um palpite; a IA pode **propor** `registrar_documento { documentType, requestItemId }`;
   o balcão **valida** (tipo aceito pela `documentPolicy`? tamanho ok? tool habilitada?)
   e só então move o `DocumentRequestItem` para `recebido`. O `@@unique` do checklist
   evita contar 2× o mesmo item.
5. **Persegue o que falta.** O agendador (§5b) roda periodicamente: pega itens
   `pendente` perto/depois do `dueAt` respeitando `lastReminderSentAt` (ex.: no máx.
   1 lembrete a cada 2 dias, teto de N), manda o lembrete, incrementa `reminderCount`,
   registra como system message na conversa.
6. **Avisa o escritório ao completar.** Quando um item vira `recebido`, emite o aviso
   **amarrado à conversa ativa do contato** (decisão (i) da §2-bis; o agendador resolve/
   abre a conversa antes de emitir) → aparece na fila `/atendente` com prioridade
   ("Cliente X enviou o extrato de junho — conferir"). Quando **todos** os itens da
   competência viram `recebido`/`aprovado`, um evento de "competência completa".

---

## 5. Os dois gaps de infra

### 5a. Receber mídia no inbound

**Onde trava:** `parseInboundMessages` (`whatsapp.server.ts:80`) só deixa passar `text`.
A Meta manda `msg.type='document'` com `msg.document = { id (media_id), mime_type, filename }`
(e `image`/`video` análogos). **O que se reusa e o que é novo:**

- **Reuso (metade barata):** validação de tamanho/MIME + escrita isolada — o miolo de
  `transcribeUploadedAudio` (`upload.server.ts:14`), depois que o binário já está em
  memória.
- **Novo (a parte cara):** (1) estender `parseInboundMessages` pra emitir
  `{ from, phoneNumberId, messageId, mediaId, mimeType, fileName }`; (2)
  `downloadMediaFromWhatsApp(mediaId)` — **dois GETs à Graph API** (`GET /{media_id}` →
  URL temporária; segundo GET baixa), Bearer de `WHATSAPP_ACCESS_TOKEN`, tratando
  `HTTP != 200`, URL expirada, timeout.

**Opções:**

- **(A) Estender o webhook agora, baixar via Cloud API.** O caminho de produção (parse +
  dois GETs + persistência isolada). `processIncomingMessage` ganha campos opcionais
  `documentUrl?`/`documentType?`/`documentMetadata?`.
  *Trade-off:* é o produto final, mas exige token válido da Meta e trata download falho.
- **(B) Upload manual pelo operador (ponte).** Antes de ligar a mídia da Meta, o operador
  sobe o arquivo por uma tela interna reusando **exatamente** `transcribeUploadedAudio`
  (trocando "transcrever" por "guardar"). É a **única** opção que herda o código de áudio
  quase igual. Destrava o resto do #2 (checklist, perseguição, aviso) sem depender do
  webhook.
  *Trade-off:* não é o produto final (não recebe do cliente sozinho), mas valida todo o
  ciclo de checklist com risco mínimo.

**Recomendação:** **(B) primeiro** pra validar o coração (checklist + perseguição) sem
bloquear na Meta, depois **(A)** como o marco que fecha o produto.

### 5b. Agendador de lembretes

**Onde trava:** não há cron/fila/`setInterval`/dependência no projeto. O app roda 24/7
via `hermes.service` (systemd user). "Perseguir" precisa de um gatilho periódico novo.

**Opções:**

- **(A) systemd timer batendo um endpoint interno.** Um `.timer` (systemd user, irmão do
  `hermes.service`) chama de X em X horas uma rota `POST /internal/run-reminders`
  (protegida por token/`requireOperator`). A rota roda a query de pendências e dispara
  os lembretes.
  *Trade-off:* fora do processo (sobrevive a restart, fácil de auditar/logar, dá pra
  rodar manual), mas é mais uma peça de infra pra configurar por deploy.
- **(B) `setInterval` dentro do processo do app.** Um loop iniciado no boot do servidor.
  *Trade-off:* zero infra nova, mas morre junto com o processo, duplica se houver 2
  instâncias e mistura "job" com "servir requests".
- **(C) Fila (BullMQ/etc.).** Robusto, com retry/backoff por item.
  *Trade-off:* dependência nova fora da stack (precisa perguntar antes) e Redis — overkill
  pro volume de um escritório.

**Recomendação:** **(A) systemd timer + endpoint interno.** Combina com o ambiente atual
(`hermes.service`), é idempotente e testável (dá pra bater o endpoint à mão), e a lógica
de "quais lembretes mandar agora" fica numa função pura testável (`selectDueReminders`),
com o timer sendo só o gatilho. Escala pra fila só se o volume justificar.

---

## 6. A fronteira determinístico vs. IA

**Nunca decidido pelo prompt (é código, no balcão):**

- **O que falta** — query sobre `DocumentRequestItem WHERE status='pendente'`.
- **Se um documento conta como recebido** — só depois de o balcão validar tipo/tamanho
  contra a `documentPolicy` do tenant. A IA propõe `registrar_documento`; o balcão decide.
- **Dedup do checklist** — a constraint `@@unique([tenantId, contactId, competencia, documentType])`
  (não similaridade lexical).
- **Quando e com que frequência perseguir** — `dueAt`, `lastReminderSentAt`, teto de
  `reminderCount`; tudo em `selectDueReminders`, determinístico.
- **Vencido** — transição por data, marcada pelo agendador.
- **Dono do documento** — `contactId` vem do `wa_id` da Meta. **No caminho de documento,
  `contactId` é obrigatório:** se vier ausente, rejeitar/lançar — **nunca** cair no
  default `'demo-user'` (`conversation.server.ts:102`) ao persistir binário, senão o
  arquivo cairia em `data/documents/<tenantId>/demo-user/` misturando origens.
- **Aviso ao escritório** — emitido por transição de estado, amarrado à conversa ativa do
  contato (decisão (i) da §2-bis).

**Papel da IA (só conversa):** redigir o pedido com o tom do tenant; entender respostas
livres ("já mandei", "esse mês não teve nota", "segue em anexo"); **sugerir** a
classificação do arquivo (tipo) — sempre como proposta validada; responder cordialmente
a rejeição ("a foto ficou ilegível, consegue reenviar?"). Fallback: se a saída não
validar, escala pra humano.

---

## 7. Templates de checklist por vertical (config por tenant)

O checklist é **dado**, não código — mesmo padrão declarativo do `TenantConfig`
(`tenant-config.ts:28`, validado por `parseTenantConfig`). Estende-se com uma
`documentPolicy` opcional:

```jsonc
// trecho de config/tenants/prestacon.json
"documentPolicy": {
  "acceptedMimes": ["application/pdf", "image/jpeg", "image/png"],
  "maxFileBytes": 15000000,
  "reminderIntervalDays": 2,
  "maxReminders": 4,
  "checklistMensal": [
    { "documentType": "nota_servico",    "label": "Notas de serviço do mês", "dueDay": 5 },
    { "documentType": "extrato_bancario","label": "Extrato bancário",        "dueDay": 5 },
    { "documentType": "guia",            "label": "Guias pagas (DAS etc.)",  "dueDay": 10 }
  ],
  "documentTypePatterns": {
    "nota_servico":     ["nfse", "nota de servico", "nota fiscal"],
    "extrato_bancario": ["extrato"],
    "guia":             ["das", "guia", "darf"]
  }
}
```

**Contabilidade (Prestacon, primeiro):** mensal — nota(s) de serviço, extrato bancário,
guias pagas; quando há folha — folha de pagamento, comprovantes de recolhimento. Alguns
itens são condicionais ("só se emitiu nota"), tratados como item que a IA pode marcar
como não-aplicável **mediante** validação.

**Outras verticais (mesmo mecanismo, só troca a config):** oficina/assistência (nota da
peça, ordem de serviço assinada), condomínio (comprovantes de despesa, atas), clínica
(guias de convênio). Um novo cliente entra **só por config** — `checklistMensal` +
`documentTypePatterns` no `<slug>.json`, sem tocar código.

**`classifyDocumentType(fileName, mimeType, patterns)` é função pura NOVA** (estilo:
`extractLeadPatch`/`audioExtensionFor`), lê os `documentTypePatterns` do tenant e devolve
o tipo ou `null` (aí a IA propõe e o operador confirma).

**Mapa MIME→extensão de documento também é código NOVO.** O `MIME_TO_EXT` /
`SUPPORTED_AUDIO_EXTENSIONS` de `transcribe.server.ts:34` **só tem áudio** — editá-los
quebraria `isSupportedAudioExtension`. Criar uma função própria (`documentExtensionFor` +
`supportedDocumentMimes` com `application/pdf`, `image/jpeg`, `image/png`…) **espelhando**
`audioExtensionFor`, sem tocar no de áudio.

---

## 8. Etapas de entrega

### Etapa 0 — Baseline honesto (o que já existe)
Não recomeçar: motor, cérebro validado, canal WhatsApp por banco, isolamento
`(tenantId, contactId)`, dossiê+fila, config declarativa, e o **miolo pós-download da
mídia do áudio** (`transcribeUploadedAudio`, hoje chamado só pelo simulador).
**Pronto:** confirmado que o #1 está no ar com cliente real antes de iniciar o #2.

### Etapa 1 — Modelo de dados (o coração)
`DocumentRequestItem` + `Document` no schema; `npx prisma migrate dev`. Funções puras
`isDocumentType`, `normalizeCompetencia`, transições de estado válidas — com testes.
**Pronto:** dá pra criar/consultar/mudar de estado um item de checklist e um documento
via banco, isolado por tenant, com dedup garantido pelo `@@unique` (sem similaridade),
tudo coberto por teste.

### Etapa 2 — Checklist como config + geração dos itens
`documentPolicy` no `TenantConfig` (parse validado). Função que, dada a competência,
gera os `DocumentRequestItem` `pendente` do template do tenant. Prestacon com checklist
mensal real. **Pronto:** rodar a geração cria exatamente os itens do template da Prestacon
para "2026-06", sem duplicar em re-execução (garantido pelo `@@unique`).

### Etapa 3 — Pedir e classificar na conversa (ponte manual) — **refactor da ação da IA**
**Este é o item de porte médio (§2-bis-a), não um plug:** transformar `AttendantAction`
em union discriminada; reescrever `validateAction` como `switch (type)` com validador por
variante e limites via `ToolPolicy`; estender `ToolName`; atualizar prompt/schema do
provider e os testes de `validate.ts`. Novas ações: `solicitar_documento` /
`registrar_documento`. `classifyDocumentType` puro (+ mapa MIME→ext de documento novo).
Upload interno pelo operador reusando o padrão do áudio (gap 5a-B). A IA pede o que falta
e propõe classificação; o balcão valida e marca `recebido`.
**Pronto:** operador sobe um PDF, a IA propõe `registrar_documento`, o balcão valida (tool
habilitada + tipo aceito), o item certo vira `recebido`, e a IA pede o que ainda falta com
o tom do tenant — sem depender da Meta; testes de `validate.ts` cobrem as novas variantes.

### Etapa 4 — Perseguição automática (agendador)
`selectDueReminders` puro (quem está `pendente`, passou/perto do `dueAt`, respeita
`lastReminderSentAt`/`maxReminders`). Endpoint interno `POST /internal/run-reminders` +
systemd timer (gap 5b-A). Marca `vencido`, incrementa `reminderCount`, registra system
message. **Pronto:** rodar o endpoint envia lembrete só para os itens devidos (sem
spam), atualiza os contadores e loga o que fez; o timer dispara sozinho.

### Etapa 5 — Aviso ao escritório + painel
Aviso em transições (`documento_recebido`, "competência completa") **amarrado à conversa
ativa do contato** (decisão (i) da §2-bis: resolver/abrir a conversa antes de emitir;
nunca emitir sem conversa). Dossiê mostra `documentsPending`/`documentsReceived`;
`/atendente` prioriza contato com doc novo pra conferir. **Pronto:** ao marcar recebido,
aparece na fila com prioridade; o operador vê, no dossiê do contato, o que chegou e o que
falta na competência.

### Etapa 6 — Receber mídia do cliente (marco) ⭐ — **isolamento de FS é pré-requisito, não pós**
Estender `parseInboundMessages` (aceitar `document`/`image`, extrair `media_id`);
`downloadMediaFromWhatsApp` (dois GETs, Bearer, tratar falha/timeout/expiração);
persistência isolada; `processIncomingMessage` com `documentUrl?` (gap 5a-A).

**Critérios de pronto que blindam o primeiro binário gravado (antes de gravar qualquer
documento sensível):**
1. **`data/` no `.gitignore`** — hoje **não está**; sem isso, extrato/folha gravados
   vazam pro Git.
2. **Path isolado por tenant com `chmod 700` na criação** de `data/documents/<tenantId>/…`.
3. **`contactId` obrigatório** no caminho de documento — rejeitar/lançar se ausente,
   **nunca** cair no default `'demo-user'` (`conversation.server.ts:102`).
4. **Checagem de `tenantId`/operador no acesso** ao arquivo (não só permissão de FS).

**Pronto:** um cliente real manda um PDF pelo WhatsApp, o Hermes recebe, guarda em path
isolado (700, fora do Git, `contactId` do `wa_id`), classifica (proposta+validação),
marca `recebido` e agradece — ponta a ponta, sem operador no meio, sem risco de vazamento.

### Etapa 7 — Operação pra cobrar
LGPD do documento (retenção, **expiração/limpeza**, aviso de tratamento); relatório de
coleta ("X completou 80% de junho?") no dashboard. (Isolamento de FS e não-vazamento já
foram pré-requisito da Etapa 6.) **Pronto:** existe política de retenção aplicada e há um
relatório de completude por competência.

### Definição de Pronto do #2
A Prestacon define o checklist mensal só por config; o Hermes pede o que falta pelo
WhatsApp real, **recebe o arquivo do cliente**, classifica com validação, marca recebido,
**persegue automaticamente** o que falta sem spammar, e avisa o escritório ao completar a
competência — com dados isolados por tenant e política de retenção do documento em vigor.
Um segundo escritório entra **só por config** (checklist + patterns no `<slug>.json`).

---

## 9. Riscos

- **LGPD de documento sensível.** Extrato bancário, nota fiscal, folha = dado sensível.
  Precisa de aviso de tratamento, **retenção/expiração** definida, e base legal.
  Rejeição/limpeza tem que apagar o binário de fato, não só a linha do banco.
- **Vazamento antes da blindagem.** O maior risco de ordem é gravar binário sensível
  **antes** de `data/` estar no `.gitignore` e o path isolado (700) — por isso isso virou
  pré-requisito da Etapa 6, não item da Etapa 7.
- **Armazenamento de arquivo.** Onde e por quanto tempo. Isolamento no FS
  (`data/documents/<tenantId>/<contactId>/`, `chmod 700`) **e** no acesso (checar
  `tenantId`/operador no `dossier.server.ts`, não só permissão de OS). Na Pi isso é
  piloto; produto pago pede VPS com backup e, idealmente, criptografia em repouso.
  Sem política de expiração, o disco cresce sem parar.
- **Custo de mídia no WhatsApp.** Cada conversa iniciada por template (lembrete
  proativo fora da janela de 24h) é **cobrada** pela Meta. Perseguir demais = custo +
  risco de o cliente marcar como spam (dano à qualidade do número). O teto de
  `reminderCount` e o intervalo mínimo não são só UX — são controle de custo e de
  reputação do número.
- **Classificação errada.** Um extrato marcado como nota fecha o item errado e some da
  perseguição. Por isso a classificação da IA é **proposta**, confirmada pelo operador
  (estado `aprovado`) antes de virar verdade contábil.
