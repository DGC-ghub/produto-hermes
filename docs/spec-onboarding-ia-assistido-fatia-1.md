# 📐 Spec — Onboarding de IA assistido, fatia 1

> **Status:** rev. 6.1 — correções cirúrgicas após a sexta revisão interna. Nenhum código escrito.
> **Data:** 2026-08-03 · **Base:** HEAD `f374a5f`, branch `feat/dominio-pronto`
> **Rev. 6 fecha as duas frases que não eram implementáveis com segurança:** `await` numa função
> best-effort não produz evidência · comparação em memória não é compare-and-swap. Mais a
> revalidação do clone no rollback e a poda que apagaria a evidência. Histórico em §20.

O problema que esta fatia resolve: hoje `/conhecimento` é um campo em branco, e um campo em branco é
um teste de escrita técnica aplicado a quem só quer parar de perder cliente no WhatsApp. Três dos
sete tenants do banco têm **zero** documentos. A qualidade do atendimento é hoje uma variável do
cliente; esta fatia a transforma numa variável nossa — que é o que torna sustentável a promessa
"a IA nunca inventa preço".

---

## 0. Escopo

**Inclui:** quatro etapas de perguntas · autosave com compare-and-swap · rascunho separado da versão
publicada · submissão assíncrona · job durável com lease · revisão interna por terminal · resumo para
o cliente · cinco perguntas com **execução provada** · integração com `/testar-ia` · aprovação do
cliente · ativação explícita · gate no motor com telemetria de shadow mode · rollback por clonagem ·
métricas do tempo de revisão.

**Não inclui:** upload e parsing de arquivos · painel web interno · automação do julgamento ·
Embedded Signup · ativação automática do WhatsApp · mudanças em billing · **worker automático**
(§6.2) · **edição de campos de risco pelo cliente** (§4.4) · **edição do candidato pelo revisor**
(§4.9).

---

## 1. Fundamentos verificados no código

| Fato | Evidência | Consequência |
|---|---|---|
| Não existe enum no Prisma | `schema.prisma:97,156,186,253` | Estados como `String` + union em TS |
| Config em `TenantConfigRecord`, `upsert` que sobrescreve | `schema.prisma:234-242`; `tenant-config-db.server.ts:35-39` | Publicar = escrever aqui |
| Zero versionamento no schema | busca vazia | Primeira tabela versionada do sistema |
| Motor relê config e knowledge a cada mensagem, sem cache | `conversation.server.ts:128,265-267` | Hoje **editar é publicar** |
| `resolveKnowledge` cai no arquivo só com 0 docs | `knowledge-db.server.ts:113-121` | Rascunho não pode morar em `KnowledgeDoc` |
| Fila durável, sem backoff | `whatsapp-queue.server.ts:209-260,249-255` | Molde do job; corrigido em §6 |
| Drain sequencial; semáforo do CLI em 1 | `whatsapp-queue.server.ts:230-260`; `claude-cli.server.ts:27` | Base de §6.2 |
| Sweeper sobe por import de rota | `whatsapp-queue.server.ts:305-309` | Módulo importado por rota registrada |
| Billing gate: `{allowed, reason}` + escape + flag | `billing-gate.server.ts:11-38` | Forma a repetir, **com `wouldAllow`** (§7.5) |
| `preview` mistura fonte e efeitos | `conversation.server.ts` (13 pontos) | Separado em §7.2 |
| `channel:'simulator'` é ambíguo | `testar-ia.tsx:60`; `demo.chat.tsx:187-191` | `ExecutionMode` (§7.2) |
| `MessageTrace` sem modo, razão **nem vínculo com `Message`**; `outcome` sobrescrito | `schema.prisma:284-300`; `conversation.server.ts:388` | Colunas novas (§7.7, §10.2) |
| **`recordMessageTrace` é `void` e desligável por `HERMES_METRICS=0`** | `conversation.server.ts:96`; `metrics.server.ts:44,60-62` | Trace de validação não pode ser best-effort (§10.2) |
| `getHandoffQueue` filtra só `status` e `tenantId` | `dossier.server.ts:213-223` | ⚠️ A demo já contamina a Central (§7.3) |
| `provisionTenant` cria "draft vazio seguro" | `provisioning.server.ts:37-56` | `AiSetup` na mesma transação |
| `app/lib/onboarding.server.ts` já existe | `onboarding.server.ts:23-53` | Módulo novo é `setup` (§11.3) |
| `/configuracoes` edita quase tudo que é de risco | `configuracoes.tsx:57-101` | Fechado em §4.4 |
| `/configuracoes` apaga `guardrails.outOfScope` | `configuracoes.tsx:81-89` | ⚠️ Bug ativo — **etapa 1** |
| `businessProfile` NÃO tem `contactChannels` | `tenant-config.ts:28-67` | Allowlist estrita (§4.2) |
| `objectives`/`tools` por cast cru | `tenant-config.ts:107-112,123,128` | §6.7 |
| `release.sh` já faz `prisma migrate deploy` | `release.sh:59-94` | §18 R-5 |

### 1.1 Estado do banco (somente leitura, 2026-08-03)

| tenant | docs | QR | natureza |
|---|---|---|---|
| `dgc` | 5 | 0 | demo pública |
| `assistencia-tecnica-demo` | 6 | 0 | demo pública |
| `prestacon` | 6 | 0 | piloto |
| `csmed` | 6 | 0 | piloto / 1º cliente |
| **`adv-gac`** | **0** | **1** | trial com WhatsApp ligado |
| `advocacia-primo` | 0 | 0 | trial |
| `qr-teste` | 0 | 0 | teste |

---

## 2. Modelo de dados

### 2.1 `Tenant`

```prisma
model Tenant {
  // ... existentes inalterados
  aiSetup         AiSetup?
  aiSetupVersions AiSetupVersion[]
  aiSetupJobs     AiSetupJob[]
  aiSetupEvents   AiSetupEvent[]
}
```

### 2.2 `AiSetup`

```prisma
model AiSetup {
  id       String @id @default(cuid())
  tenantId String @unique

  publishedVersionId String? @unique
  reviewVersionId    String? @unique

  activatedAt   DateTime? // NUNCA limpo por revisão (INV-11)
  activatedById String?

  grandfathered   Boolean   @default(false)
  grandfatheredAt DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenant           Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  publishedVersion AiSetupVersion?  @relation("published", fields: [publishedVersionId], references: [id])
  reviewVersion    AiSetupVersion?  @relation("review",    fields: [reviewVersionId],    references: [id])
  versions         AiSetupVersion[] @relation("all")
}
```

### 2.3 `AiSetupVersion`

```prisma
model AiSetupVersion {
  id       String @id @default(cuid())
  setupId  String
  tenantId String

  // draft | submitted | needs_changes | ready_to_test | customer_approved | active | superseded
  state String @default("draft")

  // onboarding | edit | rollback  (§4.6)
  origin   String  @default("onboarding")
  editRisk String?                        // safe | risky — servidor (§4.5)

  generation Int @default(0)  // ciclo de correção (§3.5)

  // Versão publicada que serviu de base. A publicação exige que ela AINDA seja a publicada
  // (§4.8, INV-13). Rollback clona e rebaseia — nunca reativa a linha antiga (§4.6).
  basePublishedVersionId String?
  // Só em origin='rollback': de qual versão os snapshots foram copiados (auditoria).
  rollbackSourceVersionId String?

  revision Int @default(0)  // CAS de toda escrita mutável (§5.2, §10.2)

  answersJson String
  submittedAt DateTime?

  // ── Candidatos: limpos ao reabrir (§3.5) ────────────────────────────
  candidateConfigJson    String?
  candidateKnowledgeJson String?
  summaryJson            String?
  gapsJson               String?
  risksJson              String?
  validationJson         String?
  validationResultsJson  String?

  // ── Revisão: resetados a cada ciclo (§3.5, §11.1) ───────────────────
  reviewStartedAt   DateTime?
  reviewCompletedAt DateTime?
  reviewer          String?
  reviewNote        String?
  changesRequested  Int      @default(0) // acumula entre ciclos (não reseta)

  approvedByAccountId String?
  approvedAt          DateTime?

  publishedAt  DateTime?
  supersededAt DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  setup  AiSetup @relation("all", fields: [setupId], references: [id], onDelete: Cascade)
  tenant Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  publishedFor AiSetup? @relation("published")
  reviewFor    AiSetup? @relation("review")
  jobs         AiSetupJob[]
  events       AiSetupEvent[]

  @@index([tenantId, state])
  @@index([setupId, createdAt])
}
```

### 2.4 `AiSetupJob`

```prisma
model AiSetupJob {
  id        String @id @default(cuid())
  versionId String
  tenantId  String

  kind           String @default("generate")
  idempotencyKey String @unique // `${versionId}:${generation}:${kind}:${tentativa}`

  status String @default("pending") // pending | processing | retry_wait | failed | completed

  attempts      Int       @default(0)
  nextAttemptAt DateTime  @default(now())
  claimedAt     DateTime? // heartbeat
  claimToken    String?   // lease (§6.5)
  startedAt     DateTime?
  finishedAt    DateTime?
  failureKind   String?   // transient | invalid_output | terminal | superseded
  lastError     String?   // sanitizado e truncado (§14)

  generation Int @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  version AiSetupVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([status, nextAttemptAt])
}
```

### 2.5 `AiSetupEvent`

```prisma
model AiSetupEvent {
  id        String  @id @default(cuid())
  tenantId  String
  versionId String?
  // submitted | job_started | job_failed | job_completed | review_started |
  // internal_approved | changes_requested | base_changed | customer_approved |
  // published | activated | rolled_back | safe_edit_published |
  // superseded_by_publish | grandfathered | grandfather_removed
  kind      String
  actor     String  // 'customer:<accountId>' | 'internal:<reviewer>@<host>' | 'system'
  detail    String? // JSON estruturado e limitado (§14)
  createdAt DateTime @default(now())

  tenant  Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  version AiSetupVersion? @relation(fields: [versionId], references: [id])

  @@index([tenantId, createdAt])
}
```

### 2.6 `MessageTrace` — quatro colunas novas

```prisma
model MessageTrace {
  // ... existentes
  executionMode      String?  // public_demo | owner_preview | whatsapp
  setupGateReason    String?  // razão HIPOTÉTICA, mesmo em shadow mode (§7.5)
  setupGateEnforced  Boolean? // a flag estava ligada nesta mensagem
  // Vínculo com a Message gerada — prova de execução (§10.2). @unique garante UMA
  // evidência por resposta: em SQLite múltiplos NULL são permitidos, então só as
  // execuções de validação recebem valor não nulo.
  assistantMessageId String?  @unique
}
```

> **Relação real com `Message`?** Não na fatia 1. Exigiria relação inversa em `Message` e política
> `onDelete`, e `Message` é append-only sem exclusão hoje. Fica como coluna com `@unique`; se um dia
> houver purga de mensagens, reavaliar antes.

### 2.7 Impacto da migration

| Item | Quantidade |
|---|---|
| Tabelas novas | **4** |
| `@@index` explícitos | **4** (2 em `AiSetupVersion`, 1 em `AiSetupJob`, 1 em `AiSetupEvent`) |
| `@unique` | **5** (`AiSetup.tenantId`, `publishedVersionId`, `reviewVersionId`, `AiSetupJob.idempotencyKey`, **`MessageTrace.assistantMessageId`**) |
| Colunas novas em tabela existente | **4**, nullable, em `MessageTrace` (§2.6) |

O SQL final — número de `ALTER TABLE`, índices implícitos de `@unique` — é **determinado pela
migration gerada**, não prometido aqui. Revisar o arquivo antes de aplicar.

> ⚠️ Acrescentar `@unique` numa coluna de tabela existente e populada exige atenção: o SQLite cria
> um índice único, e linhas antigas ficam com `NULL` (permitido). Conferir na migration gerada que
> nenhum backfill de valor é tentado.

---

## 3. Máquinas de estados

### 3.1 Versão — sete estados

| # | Estado | Significado |
|---|---|---|
| 1 | `draft` | cliente preenchendo; `answersJson` mutável |
| 2 | `submitted` | enviado; job enfileirado, rodando ou aguardando revisão |
| 3 | `needs_changes` | lacunas do job, correção pedida pelo revisor, ou **base mudou** (§4.8) |
| 4 | `ready_to_test` | aprovado internamente; **simulador liberado** |
| 5 | `customer_approved` | cliente aprovou e publicou; **só na primeira configuração** (§3.4) |
| 6 | `active` | publicada e servindo o WhatsApp |
| 7 | `superseded` | outra versão tomou o lugar. **Terminal de verdade** — o rollback clona, não reativa (§4.6) |

### 3.2 Transições

| De → Para | Quem | Pré-condições | Efeitos | Simulador | WhatsApp |
|---|---|---|---|---|---|
| — → `draft` | sistema | tenant criado | cria `AiSetup` + versão em `provisionTenant` | bloqueado | bloqueado |
| — → `active`/`customer_approved` | **interno (rollback)** | `setup:rollback` | cria versão `origin='rollback'` clonando snapshots e **publica na mesma transação** (§4.6) | liberado | conforme `activatedAt` |
| **— → `active`** | **system** (edição segura) | `setup.activatedAt != null`; `origin='edit'`; `editRisk='safe'` **classificado no servidor** (§4.5); `basePublishedVersionId` ainda é a publicada | cria **e publica na mesma transação** (§4.7); preserva `activatedAt` e `reviewVersionId`; invalida review obsoleta (§4.8); evento `safe_edit_published` | liberado | **permanece liberado** |
| `draft` → `submitted` | owner | obrigatórios completos | congela respostas; `submittedAt`; **`generation++`**; grava `basePublishedVersionId`; cria job | bloqueado | bloqueado |
| `submitted` → `needs_changes` | job **ou** interno | lacunas, ou correção pedida | `gapsJson`/`reviewNote`; `changesRequested++` | bloqueado | bloqueado |
| **`submitted` → `needs_changes`** | **system** | **base mudou** (§4.8) | nota automática `base_changed`; invalida job da geração | bloqueado | bloqueado |
| `submitted` → `ready_to_test` | interno | job `completed` **desta geração** | `reviewer`, `reviewCompletedAt` | **liberado** | bloqueado |
| `needs_changes` → `draft` | owner | — | **limpa artefatos, marcações e `reviewNote`** (§3.5) | bloqueado | bloqueado |
| `ready_to_test` → `needs_changes` | owner | — | "Pedir alteração" | bloqueado | bloqueado |
| **`ready_to_test` → `needs_changes`** | **system** | **base mudou** (§4.8) | nota automática `base_changed`; invalida marcações | bloqueado | bloqueado |
| `ready_to_test` → `customer_approved` | owner | `activatedAt == null`; 5 marcações aprovadas desta geração; base válida | **publica** (§4.1) | liberado | bloqueado |
| `ready_to_test` → `active` | owner | `activatedAt != null`; mesmas condições | **publica**; `activatedAt` preservado | liberado | **permanece liberado** |
| `customer_approved` → `active` | owner | versão publicada existe | **"Liberar minha IA"** (§10.4) | liberado | **liberado** |
| `active`/`customer_approved` → `superseded` | sistema | outra versão publicada | `state='superseded'` + `supersededAt` | — | — |

> A edição segura **não** usa `draft → active`: o cliente nunca edita essa versão como questionário.
> Ela nasce e publica dentro da mesma transação, por transição de `system`. Nenhum campo dela
> (`origin`, `editRisk`, `state`) pode vir da request — todos são determinados no servidor (§4.5).

Não há `superseded → active`, nem transição para `superseded` a partir de `draft`, `submitted` ou
`needs_changes`. Transições não listadas lançam.

> Se a review estiver em `draft` ou `needs_changes` quando a base mudar, **nada muda de estado** — a
> próxima submissão simplesmente captura o novo `basePublishedVersionId`.

### 3.3 Job — cinco estados

`pending` → `processing` → (`retry_wait` → `pending`)* → `completed` | `failed`.
`job.failed` nunca muda o estado da versão (§6.4).

### 3.4 Revisão de tenant já ativo

```
Primeira configuração (activatedAt == null):  ready_to_test → customer_approved → active
Revisão de tenant ativo (activatedAt != null): ready_to_test → active
```

### 3.5 Ciclos de correção — `generation`

`ready_to_test → needs_changes → draft` reutiliza o mesmo `AiSetupVersion.id`. Sem contador de
ciclo, o histórico do simulador vazaria entre a candidata reprovada e a corrigida.

`generation` incrementa a cada `draft → submitted`, e entra em: identidade do simulador (§10.3),
`idempotencyKey` do job, marcações de validação (§10.2) e autorização do job.

**Ao reabrir (`needs_changes → draft`), limpar:** `candidateConfigJson`, `candidateKnowledgeJson`,
`summaryJson`, `gapsJson`, `risksJson`, `validationJson`, `validationResultsJson`,
`approvedByAccountId`, `approvedAt`, `reviewStartedAt`, `reviewCompletedAt`, `reviewer`,
**`reviewNote`** e qualquer aviso derivado do ciclo anterior. `changesRequested` **acumula**. Os
`AiSetupEvent` preservam o histórico.

> Alternativa descartada: nova `AiSetupVersion` a cada ressubmissão — mais limpo, porém multiplica
> linhas e exige repensar `reviewVersionId @unique` a cada ciclo.

### 3.6 `superseded` é terminal

Nenhuma versão sai de `superseded`. O rollback **clona** (§4.6). Isso mantém INV-13 verdadeira sem
exceções, preserva o histórico intacto e deixa a linha do tempo linear.

---

## 4. Versionamento

### 4.1 Publicar — o ponteiro é tomado por compare-and-swap

Comparar `version.basePublishedVersionId === setup.publishedVersionId` **em memória** não impede
TOCTOU: duas publicações podem ler P1 como atual, A publicar P2, e B seguir com o snapshot velho.
O SQLite provavelmente serializaria ou devolveria `SQLITE_BUSY` em vários casos, mas **a invariante
não pode depender de comportamento incidental do banco**. O ponteiro é tomado por CAS:

```ts
db.$transaction(async (tx) => {
  // 0. Consistência de tenant (INV-12) — leitura simples basta, tenantId não muda.
  if (setup.tenantId !== version.tenantId) throw new TenantMismatchError()

  // 1. CAS no ESTADO da versão que vai publicar (varia por caminho — ver tabela abaixo).
  const versionClaimed = await tx.aiSetupVersion.updateMany({
    where: { id: version.id, tenantId, state: estadoEsperadoDoCaminho },
    data:  { publishedAt: now, state: setup.activatedAt ? 'active' : 'customer_approved' },
  })
  if (versionClaimed.count !== 1) throw new StaleVersionStateError()

  // 2. CAS no PONTEIRO — é isto que aplica a INV-13, não a comparação em memória.
  const claimed = await tx.aiSetup.updateMany({
    where: {
      id: setup.id,
      tenantId,
      publishedVersionId: version.basePublishedVersionId, // null casa com null (1ª publicação)
      // A exigência do ponteiro de review entra AQUI, no CAS — não numa comparação
      // anterior em prosa: só o caminho "review" a aplica, e ela é verificada pelo banco.
      ...(publicaReview ? { reviewVersionId: version.id } : {}),
    },
    data: {
      publishedVersionId: version.id,
      ...(publicaReview ? { reviewVersionId: null } : {}), // demais caminhos preservam
    },
  })
  if (claimed.count !== 1) throw new StaleSetupVersionError()

  // 3. Conteúdo. Tudo na MESMA transação: o ponteiro não fica visível antes.
  await tx.tenantConfigRecord.upsert({ where: { tenantId }, ... json: candidateConfigJson })
  await tx.knowledgeDoc.deleteMany({ where: { tenantId } })
  await tx.knowledgeDoc.createMany({ data: candidateKnowledgeJson })

  // 4. Supersede da anterior — também condicional: só se ela AINDA é a que se esperava.
  if (anterior && anterior.id !== version.id) {
    const sup = await tx.aiSetupVersion.updateMany({
      where: { id: anterior.id, tenantId, state: { in: ['active', 'customer_approved'] } },
      data:  { state: 'superseded', supersededAt: now },
    })
    if (sup.count !== 1) throw new StaleVersionStateError()
  }

  // 5. Review pendente baseada na publicada ANTERIOR → §4.8 (transição `system`).
  // 6. tx.aiSetupEvent.create({ kind: 'published' | 'safe_edit_published' | 'rolled_back' })
}, { maxWait: 20_000, timeout: 20_000 })
```

**Os três caminhos, com pré-condições distintas:**

| Caminho | `publicaReview` | `estadoEsperadoDoCaminho` | `reviewVersionId` | Extra |
|---|---|---|---|---|
| Publicação da própria review | **`true`** | `ready_to_test` | exigido **no `where`** e depois **limpo** | 5 marcações aprovadas da geração |
| Edição segura (§4.7) | `false` | versão recém-criada nesta transação (§3.2, `— → active`) | **preserva** | depois invalida a review baseada na anterior (§4.8) |
| Rollback (§4.6) | `false` | versão recém-criada com `origin='rollback'` | **preserva** | revalidação do snapshot (§4.6) |

Qualquer `count !== 1` aborta a transação inteira. Nada é publicado pela metade.

### 4.2 Campos seguros — allowlist estrita

`businessProfile.workingHours` · `businessProfile.address` — **e nada mais**. `contactChannels` não
existe no `TenantConfig`; acrescentá-lo exigiria campo, parser, serializer, formulário, consumo no
motor, knowledge candidata e testes.

### 4.3 Campos de risco

preços/descontos/prazos/condições · serviços e escopo · regiões que alteram escopo · `neverPromise` ·
`escalationPolicy.triggers` · handoff · `tools` · `name`/`segment`/`tone` · `extraRules` ·
`knowledge.sourcePolicy` · **qualquer documento de knowledge**.

### 4.4 Destino das telas antigas

| Tela | Sem setup ativo | Tenant ativo |
|---|---|---|
| `/configuracoes` | redireciona para `/preparar-ia` | edita **apenas** `workingHours` e `address`; risco em **somente leitura** + "Propor alteração" |
| `/conhecimento` | redireciona para `/preparar-ia` | **somente leitura** + "Propor alteração" |

"Propor alteração" cria/reabre um `draft` copiando `answersJson` da publicada. `POST` forjado
alterando campo de risco é **rejeitado (400)** — não cria versão incompleta.
`classifyConfigDiff` permanece como defesa no servidor.

### 4.5 Classificação de risco — no servidor

```ts
export function classifyConfigDiff(published: TenantConfig, incoming: TenantConfig): 'safe' | 'risky'
```

Allowlist (`safe` só se todas as diferenças estiverem em `{workingHours, address}`) · campo
desconhecido é `risky` · sem diferença é no-op · falha ao comparar é `risky` · qualquer alteração de
knowledge é `risky`.

### 4.6 Rollback — por clonagem, não por reativação

A rev. 4 mandava republicar a versão antiga pelo caminho de §4.1 — **impossível**: uma versão antiga
foi baseada numa ainda mais antiga, então `basePublishedVersionId ≠ publishedVersionId` e a própria
INV-13 abortaria o rollback.

```
Estado:  P1 → P2 → P3 (ativa).  Alvo: voltar ao conteúdo de P1.

setup:rollback -- <slug> --para P1
  cria R1:
    origin = 'rollback'
    rollbackSourceVersionId = P1.id
    answersJson, candidateConfigJson, candidateKnowledgeJson = cópias de P1
    basePublishedVersionId = P3.id      ← a publicada ATUAL
  REVALIDA o snapshot (abaixo)
  publica R1 na mesma transação (§4.1, caminho "rollback")
  P3 → superseded ;  R1 → active (ou customer_approved, conforme activatedAt)
```

Assim: INV-13 continua válida sem exceção; **P1 não é mutada** e não precisa ter `supersededAt`
limpo; a linha do tempo permanece linear; o evento `rolled_back` registra a fonte.

**Revalidação obrigatória do snapshot histórico.** Uma versão válida meses atrás pode não atender ao
contrato de hoje — o parser é artesanal e evolui, e uma tool pode ter sido removida. Antes de
publicar o clone, o comando:

1. roda o `parseTenantConfig` **atual** sobre `candidateConfigJson`;
2. valida as `tools` contra a whitelist **atual** (§6.7);
3. exige `candidateKnowledgeJson` com ≥ 1 doc de conteúdo não-branco;
4. confere `version.tenantId === setup.tenantId`;
5. **mostra o diff** entre a config publicada agora e o conteúdo a restaurar, e pede confirmação.

Qualquer falha aborta **antes** de tocar em produção, com a mensagem dizendo qual campo do snapshot
não passa mais. Rollback nunca publica conteúdo que a validação atual rejeitaria.

### 4.7 Edição segura também é versionada

O snapshot publicado nunca é mutado. Uma alteração segura cria versão `origin='edit'`,
`editRisk='safe'`, copia a knowledge da publicada, aplica o diff, publica atomicamente, preserva
`activatedAt` e grava `safe_edit_published`. Não passa por job nem revisão.

### 4.8 Mudança de base invalida a candidata pendente

Cenário: P1 ativa → revisão de risco R1 (base P1) → cliente corrige o horário → edição segura
publica P2 → R1 publicaria depois **com o horário de P1**, desfazendo a correção.

`basePublishedVersionId` é gravado na submissão. A publicação exige, na transação,
`version.basePublishedVersionId === setup.publishedVersionId`; divergente **aborta** (INV-13).

**Na mesma transação da edição segura** (ou de qualquer publicação que mude a base):

1. publica a versão segura;
2. **preserva `reviewVersionId`** (só limpa se a review for a própria versão publicada);
3. se a review estiver em `submitted` ou `ready_to_test`, move para **`needs_changes`** pela
   transição de `system` declarada em §3.2, com nota automática *"a configuração base mudou —
   reenvie para gerar sobre a versão atual"*;
4. **invalida o claim e o job daquela geração** (`failureKind='superseded'`); o worker antigo perde
   autorização pelo `claimToken` (§6.5);
5. as marcações de validação daquela geração deixam de valer (§10.2);
6. grava `AiSetupEvent(kind='base_changed')`.

Se a review estiver em `draft` ou `needs_changes`, **nada muda de estado** — a próxima submissão
captura a nova base. Nunca há merge automático.

### 4.9 O revisor **não** edita o candidato

A rev. 4 dizia que "a equipe faz os ajustes avançados durante a revisão" sem nenhum comando que
editasse `tools`, `sourcePolicy`, `extraRules` ou `tone` — promessa sem mecanismo.

**Decisão (opção A) para a fatia 1:**

- campos estruturais são **políticas fixas montadas pelo servidor** (§6.7);
- o agente gera **apenas conteúdo de negócio**;
- o revisor **aprova** ou **pede nova resposta/reprocessamento** — não edita artefato;
- **customização avançada por tenant está explicitamente fora da fatia 1**.

> Caminho futuro (opção B), registrado para não se perder: um comando
> `setup:ajustar -- <slug> --generation <n> --reviewer <nome> --file <patch.json>`, com allowlist
> estrita, validação completa, CAS, evento auditável, limpeza das avaliações, proibição de
> prompt/output cru e sem tocar em campos estruturais controlados pelo servidor. Fora do escopo
> desta entrega.

---

## 5. Questionário

### A. Empresa e público

| Campo | Obrigatório | Vira |
|---|---|---|
| nome da empresa | ✅ | `businessProfile.name` |
| segmento | ✅ | `businessProfile.segment` |
| o que a empresa faz | ✅ | knowledge |
| tipo de cliente | — | knowledge |
| cidade / região atendida | ✅ | knowledge + `outOfScope` quando limita escopo |

### B. Serviços e condições

| Campo | Obrigatório | Vira |
|---|---|---|
| serviços oferecidos (≥1) | ✅ | knowledge |
| serviços **não** oferecidos | ✅ | `guardrails.outOfScope` |
| como contratar | ✅ | knowledge |
| preços conhecidos | — | knowledge (vazio → `neverPromise` de preço) |
| condições e limites | — | knowledge + `neverPromise` |

### C. Operação

| Campo | Obrigatório | Vira |
|---|---|---|
| horário | ✅ | `businessProfile.workingHours` |
| canais de contato | — | knowledge |
| prazo usual de resposta | — | knowledge |
| informações permitidas na triagem | ✅ | knowledge + `nextStepPrompt` |
| próximo passo esperado | ✅ | `escalationPolicy` / `nextStepPrompt` |

### D. Segurança e handoff — inteira obrigatória

assuntos sensíveis → `triggers` · nunca prometer → `neverPromise` · dados que nunca pedir →
knowledge + regra · quando chamar humano → `escalationPolicy` · fora de escopo → `outOfScope`.

### 5.1 Completude

`isStepComplete`/`isReadyToSubmit` puras, com teste. Texto obrigatório ≥ 15 caracteres
não-brancos; lista ≥ 1 item com ≥ 3. Progresso = etapas/4. O `POST` revalida no servidor.

### 5.2 Autosave com CAS

```ts
updateMany({
  where: { id, tenantId, state: 'draft', revision: expectedRevision },
  data:  { answersJson, revision: { increment: 1 } },
})
```

`count === 0` → **409**. `revision` controla **todas** as escritas mutáveis (respostas e marcações).

---

## 6. Job assíncrono

### 6.1 Contrato

Entrada: snapshot imutável `{ versionId, generation, tenantId, tenantSlug, answers }`. Nunca relê
`answersJson` após o claim; nunca lê produção.
Saída: `candidateConfigJson`, `candidateKnowledgeJson`, `summaryJson`, `gapsJson`, `risksJson`,
`validationJson`.

### 6.2 Sem worker automático

Claude CLI tem concorrência **1** e o drain do WhatsApp é sequencial: um job de minutos faria
mensagem real esperar e cair no fallback. Lote 1 protege os jobs entre si, **não** o WhatsApp.

| | |
|---|---|
| Submissão | persiste e responde imediatamente |
| Worker automático | **desligado** — `SETUP_WORKER_ENABLED`, default `0` |
| Processamento | `npm run setup:processar`, janela assistida |
| Tela | "em revisão"; não promete prazo |
| Sweeper | faz as faxinas; **não reivindica** com a flag desligada |

Ligar exige Anthropic API ou capacidade separada.

### 6.3 Padrão da fila

Claim por `updateMany` com status esperado + `claimToken`; `attempts` no claim; lote FIFO por
`[status, nextAttemptAt]`; as duas faxinas; sweeper `setInterval` + `unref()` + guard em
`globalThis`; `markDone` com retry e alarme. `MAX_ATTEMPTS=3`, **lote 1**, sweep 60s.

### 6.4 Taxonomia de falhas

| Situação | `status` | `failureKind` | `version.state` | Alarme |
|---|---|---|---|---|
| provider caiu, timeout, `SQLITE_BUSY` | `retry_wait` → `pending` | `transient` | inalterado | só ao esgotar |
| JSON inválido | `retry_wait` → `pending` | `invalid_output` | inalterado | só ao esgotar |
| **lacunas de negócio** | **`completed`** | — | **`needs_changes`** | não |
| validação determinística reprovou | `failed` | `terminal` | inalterado | sim |
| geração/base obsoleta (§4.8) | `failed` | `superseded` | inalterado | não |
| esgotou tentativas | `failed` | último visto | inalterado | sim |

### 6.5 Backoff, heartbeat e lease

`nextAttemptAt = now + 2^(attempts - 1) × 60s` (1, 2, 4 min). Heartbeat atualiza `claimedAt` a cada
60s; órfão em 30 min. `claimToken` gerado no claim; heartbeat, conclusão, falha e transação final
filtram por `id + status='processing' + claimToken`.

### 6.6 As cinco perguntas

```json
{ "id": "q1", "question": "Vocês atendem no sábado?",
  "expectedFacts": ["horário de sábado é 9h-13h"],
  "expectedBehavior": "responder com o horário, sem prometer fora dele",
  "shouldHandoff": false }
```

### 6.7 O servidor monta a config final

A whitelist de `tools` impede ferramenta inventada, mas não impede prompt injection do questionário
alterar campo estrutural válido. O agente produz **somente conteúdo de negócio**; o servidor
constrói ou força: `slug`, `knowledge.sourceDir`, o conjunto de `tools` e seus `limits`, defaults
estruturais, limites técnicos e campos de provider. Só então `parseTenantConfig` + as validações
(7 obrigatórios, whitelist, ≥ 1 doc com conteúdo).

---

## 7. Gate no motor

### 7.1 Onde

Antes do billing gate (`conversation.server.ts:201`), depois de `ctx.tenantId` (L127), como
`timer.step('setup_gate', …)`.

### 7.2 `ExecutionMode`

| `mode` | `channel` | `operationalEffects` | fonte |
|---|---|---|---|
| `public_demo` | `simulator` | **`false`** | publicada |
| `owner_preview` | `simulator` | **`false`** | candidata (via `setupVersionId`) ou publicada |
| `whatsapp` | `whatsapp` | **`true`** | publicada |

Obrigatório; omitir é erro de tipo.

### 7.3 Demo pública sem efeitos operacionais

Corrige bug ativo: `getHandoffQueue` filtra só `status` e `tenantId`
([dossier.server.ts:213](app/lib/dossier.server.ts:213)) — a Central recebe visitante anônimo.
`/demo/chat` passa a ler `needsHuman` do **retorno**, não do status persistido
(`demo.chat.tsx:224`).

### 7.4 Resolução segura da candidata

A rota passa **apenas `setupVersionId`**. O servidor busca; exige `version.tenantId === tenant.id`;
exige `ready_to_test` (ou usa a publicada quando ativo); **revalida** com `parseTenantConfig` +
whitelist; resolve internamente.

### 7.5 Decisão calculada ≠ aplicada

```ts
export type SetupGateReason =
  | 'grandfathered' | 'active' | 'preview_ready' | 'published'
  | 'not_ready' | 'not_activated' | 'no_setup'

export type SetupGateDecision = {
  allowed: boolean; wouldAllow: boolean; reason: SetupGateReason; enforced: boolean
}
```

`gate_disabled` **não existe** como razão — a flag é o campo `enforced`.

### 7.6 Regras (valores de `wouldAllow`)

| Situação | `owner_preview` | `whatsapp` | `public_demo` |
|---|---|---|---|
| sem `AiSetup` | bloqueado (`no_setup`) | bloqueado | bloqueado |
| `grandfathered` | permitido | permitido | permitido |
| `draft`/`submitted`/`needs_changes`, sem publicada | bloqueado (`not_ready`) | bloqueado | bloqueado |
| `ready_to_test` | **permitido** | bloqueado (`not_activated`) | bloqueado |
| `customer_approved` | permitido | **bloqueado** (`not_activated`) | permitido |
| `active` | permitido | **permitido** | permitido |

### 7.7 Telemetria

`executionMode`, `setupGateReason`, `setupGateEnforced` e `assistantMessageId` (§2.6). `outcome`
continua sendo o desfecho real.

### 7.8 Ao bloquear

**WhatsApp:** provider não chamado; mensagem persistida; conversa a `needs_human`; `reply: ''`
(silêncio); `outcome='setup_blocked'`; alarme com cooldown.
**Simulador:** `reply` com orientação, `handoffReason: 'setup_not_ready'`.
**Demo:** mensagem pública amigável.

### 7.9 Gate do canal

`/canais` (`canais.tsx:131-136`) recusa antes de `channelSession.create` + `startPairing`. Mesma
checagem em `whatsapp.server.ts:147`.

---

## 8. Grandfathering e rollout

### 8.1 Backfill

| tenant | destino |
|---|---|
| `dgc`, `assistencia-tecnica-demo` | publicada + `active`, sem `grandfathered` permanente |
| `prestacon`, `csmed` | publicada + `active` + `grandfathered` |
| `advocacia-primo`, `qr-teste` | `draft` |
| **`adv-gac`** | `active` + `grandfathered` temporário |

Sintetiza a versão publicada do estado atual, **preenche `activatedAt`** e grava
`basePublishedVersionId = null`.

### 8.2 `grandfathered` é temporário e auditado

Evento com motivo; alerta operacional na conta; edição bloqueada fora do onboarding; revisão
assistida obrigatória; flag removida na aprovação.

### 8.3 Ordem do rollout

1. migration (4 tabelas + 4 colunas em `MessageTrace`);
2. backfill dry-run, conferido tenant a tenant;
3. gate com `SETUP_GATE_ENABLED=0`;
4. **consulta real** (`wouldAllow` não é persistido — é derivável da razão):

```sql
SELECT t.slug, m.executionMode, m.setupGateReason, COUNT(*) AS n
FROM MessageTrace m JOIN Tenant t ON t.id = m.tenantId
WHERE m.setupGateEnforced = 0
  AND m.setupGateReason IN ('no_setup','not_ready','not_activated')
GROUP BY 1,2,3 ORDER BY n DESC;
```

Resultado esperado: **zero linhas** para tenants existentes; as duas demos verificadas
explicitamente;
5. só então ligar a flag.

---

## 9. Compare-and-swap nas transições

```ts
updateMany({ where: { id, tenantId, state: estadoEsperado }, data: { state: proximo, ... } })
```

`count === 0` → conflito. Vale para submissão, claim de revisão, aprovação interna, aprovação do
cliente, ativação, publicação, invalidação por base e marcações.

---

## 10. Aprovações, avaliações e ativação

### 10.1 As duas aprovações

| | Interna | Do cliente |
|---|---|---|
| Onde | terminal (§11) | `/preparar-ia` |
| Quando | `submitted`, job `completed` desta geração | `ready_to_test` + 5 marcações aprovadas |
| Papel | acesso ao servidor é o controle | `owner` |
| Visibilidade | **nunca** na conta do cliente | — |

### 10.2 As avaliações provam execução

Persistir só a opinião permitiria marcar cinco "aprovado" **sem chamar o provider**. Cada resultado
é ligado a uma execução real:

```json
{ "questionId": "q1", "status": "approved",
  "assistantMessageId": "msg-id", "conversationId": "conv-id",
  "setupVersionId": "ver-id", "generation": 2,
  "note": null, "markedByAccountId": "acc-id", "markedAt": "..." }
```

**O vínculo trace–mensagem não existia.** `MessageTrace` só tinha `conversationId`, e a gravação é
`void` e desligável por `HERMES_METRICS=0` (`conversation.server.ts:96`; `metrics.server.ts:44,60`)
— era impossível provar que um trace pertence à resposta marcada.

#### Por que `await recordMessageTrace(...)` **não** resolve

A função atual (`metrics.server.ts:59-86`) foi desenhada para nunca afetar o atendimento:

- `if (!metricsEnabled()) return` — com `HERMES_METRICS=0` **não grava e não avisa**;
- `try { … } catch { console.error }` — **engole qualquer erro**, e a Promise resolve normalmente;
- retorna `Promise<void>` — o chamador **não tem como saber** se existe evidência;
- dispara `pruneOldTraces()` a cada `PRUNE_EVERY` gravações (`metrics.server.ts:76-80`).

Uma implementação que seguisse a rev. 5 ao pé da letra colocaria `await` na função atual e
continuaria **sem prova nenhuma**. Portanto, uma API separada:

```ts
// app/lib/metrics.server.ts — NOVA; a recordMessageTrace atual fica inalterada
export async function recordRequiredValidationTrace(
  input: RecordTraceInput & {
    assistantMessageId: string
    executionMode: 'owner_preview'
  },
): Promise<{ traceId: string }>
```

**Contrato:**

- **ignora `HERMES_METRICS`** — não chama `metricsEnabled()`;
- **não engole erro** — propaga para o chamador;
- **retorna o id realmente persistido**;
- **não executa a poda** como efeito colateral — a rotina eventual fica só na função best-effort;
- **exclusividade de caminho**: em `owner_preview` esta é a **única** gravação de trace —
  `recordMessageTrace` **não** é chamada em paralelo. Um modo, um caminho:

  ```
  owner_preview          → recordRequiredValidationTrace
  public_demo, whatsapp  → recordMessageTrace (best-effort, inalterada)
  ```

- **idempotente por `assistantMessageId`**, na ordem certa:

  ```
  create → se P2002 → findUnique(assistantMessageId) → VALIDAR metadados → devolver
  ```

  Não `find` seguido de `create`: duas chamadas simultâneas disputariam o índice único e uma
  quebraria. O caminho é tentar criar e tratar a violação.

  Ao reutilizar um trace existente, **validar antes de devolver**: mesmo `tenantId`, mesma
  `conversationId`, `executionMode='owner_preview'` e `provider`/`outcome` compatíveis com esta
  gravação. **Metadados divergentes → conflito**, não reutilização — evidência inconsistente é pior
  que evidência ausente.

#### O que o motor faz em `owner_preview`

1. persiste a mensagem assistente;
2. chama `recordRequiredValidationTrace`;
3. sucesso → devolve `validationEvidenceAvailable: true`;
4. falha → **não apaga a resposta já persistida**;
5. registra o erro sanitizado (§14);
6. devolve `validationEvidenceAvailable: false`;
7. a tela **mostra a resposta**, mas **desabilita a marcação** e orienta executar de novo.

#### A poda não pode apagar a evidência

`pruneOldTraces` apaga por `createdAt` além da retenção (`metrics.server.ts:91-95`). Uma versão que
fique em `ready_to_test` por mais tempo que a janela perderia a prova. Duas regras:

- a poda **preserva** traces com `assistantMessageId` não nulo (são evidência, não telemetria);
- a **aprovação final não revalida** contra o trace: ela confia em `validationResultsJson`, que já
  foi validado no momento da marcação. A verificação contra o trace acontece **uma vez**, ao marcar.

Validações na marcação:

- trace com o **mesmo `assistantMessageId`**, mesmo tenant, mesma conversa;
- `executionMode='owner_preview'`;
- `contactId` da conversa corresponde a **esta versão e geração**;
- existe pergunta do cliente imediatamente relacionada;
- **outcome compatível**: pergunta normal → `outcome='ok'` e `provider` real (nunca `mock`/`nenhum`);
  pergunta com `shouldHandoff=true` → `outcome='guard_handoff'`;
- a marcação pertence à geração atual — as de geração anterior são descartadas (§3.5, §4.8).

Escrita por CAS em `revision` (§5.2). Marcação só habilitada **depois** da resposta persistida.

### 10.3 Integração com `/testar-ia`

`ready` vem do gate; em `ready_to_test` o loader devolve as 5 perguntas e as marcações da geração
corrente; a execução usa `mode:'owner_preview'` + `setupVersionId`; `operationalEffects=false`.

```
contactId = `simulator:${accountId}:${setupVersionId}:${generation}`
```

`simulatorContactId` (`testar-ia.tsx:32`) ganha os dois parâmetros.

### 10.4 Ativação — "Liberar minha IA"

Em `/preparar-ia`, após `customer_approved`:

> "Sua IA foi aprovada. Agora você pode liberar a conexão com o WhatsApp." **[ Liberar minha IA ]**

Action: exige `owner`; exige versão publicada; exige `state='customer_approved'`; CAS; grava
`activatedAt`/`activatedById`; evento `activated`; vai a `active`; redireciona para `/canais`.
Não aparece na revisão de tenant já ativo.

---

## 11. Comandos internos

| Comando | Contrato |
|---|---|
| `setup:pendentes` | `submitted`/`needs_changes`: slug, estado, geração, `submittedAt`, idade, job, correções, **quem assumiu** |
| `setup:ver -- <slug>` | dados completos. **Somente leitura** |
| `setup:revisar -- <slug> --reviewer <nome>` | claim atômico (§11.1) |
| `setup:processar [-- <slug>]` | roda o job em janela assistida (§6.2) |
| `setup:aprovar -- <slug> --reviewer <nome> [--nota]` | job `completed` desta geração; `submitted → ready_to_test` |
| `setup:corrigir -- <slug> --reviewer <nome> --nota "..."` | `→ needs_changes`; nota obrigatória |
| `setup:rejob -- <slug>` | só se `failed`; nova `idempotencyKey` |
| `setup:historico -- <slug>` | eventos + versões + **duração de cada ciclo** |
| `setup:backfill [-- --sim]` | dry-run por padrão |
| `setup:rollback -- <slug> --para <versionId>` | **clona e publica** (§4.6), com confirmação |

Nenhum comando age sem imprimir slug, nome, versão, geração, estado e reviewer, e sem `--sim`.

### 11.1 `setup:revisar` — claim atômico, por ciclo, e só com artefatos prontos

Assumir a revisão antes de os artefatos existirem faria o relógio de 30 minutos medir **espera do
job**, não trabalho humano. Pré-condições:

- job `completed` **e** `job.generation === version.generation`;
- artefatos candidatos presentes e válidos;
- versão ainda em `submitted`;
- base ainda válida (§4.8).

```ts
updateMany({
  where: { id, tenantId, state: 'submitted', reviewStartedAt: null },
  data:  { reviewStartedAt: now, reviewer },
})
```

`count === 0` → conflito, mostrando **quem já assumiu**. Evento `review_started` na mesma transação.
A espera do job continua medida por `submittedAt` e não contamina o tempo de revisão.

### 11.2 Reviewer

Obrigatório, normalizado, rejeita vazio ou < 3 caracteres. `INTERNAL_REVIEWER` preenche o default,
mas o comando **imprime antes da confirmação**. Evento grava
`actor='internal:<reviewer>@<hostname>'` e o usuário do processo.

### 11.3 Módulo

`app/lib/setup/` (`state.ts`, `answers.ts`, `diff.ts`, `gate.server.ts`, `job.server.ts`,
`publish.server.ts`). Não reusa `app/lib/onboarding.server.ts`.

---

## 12. Revisão humana como operação

Por ciclo: `submittedAt`, `reviewStartedAt`, `reviewCompletedAt`, `reviewer`, `changesRequested`.
10 primeiros clientes; meta de até 30 minutos **por ciclo**; medir antes de prometer SLA.

---

## 13. Consistência de tenant

Versão só usa `setupId` do mesmo tenant; job só usa `versionId` do mesmo tenant; publicação valida
na transação; nenhum comando confia só no slug; todo `create` por função única em transação;
inconsistência é **falha terminal + alarme**.

---

## 14. Sanitização

`lastError` sanitizado e truncado; `detail` estruturado e limitado; nunca output cru, prompt
integral, senha, token ou PII; `gapsJson`/`risksJson` estruturados; debug com conteúdo desligado em
produção.

---

## 15. Invariantes

Tabela autoritativa. **Não usar numeração fora daqui.**

| # | Invariante |
|---|---|
| INV-1 | Versão em `active`/`customer_approved` tem `publishedAt` e é apontada por `publishedVersionId` |
| INV-2 | `answersJson` só muda em `draft`, via CAS em `revision` |
| INV-3 | No máximo **uma** versão não terminal (`state ∉ {active, superseded}`) por setup |
| INV-4 | O job nunca escreve em `TenantConfigRecord` nem `KnowledgeDoc` |
| INV-5 | Artefatos candidatos não entram em produção antes da publicação |
| INV-6 | Publicação é atômica |
| INV-7 | Publicar substitui a knowledge inteira |
| INV-8 | Ausência de `AiSetup` **nega** |
| INV-9 | Nenhum modo de simulação produz efeito operacional |
| INV-10 | Versão em revisão nunca altera o que a IA usa |
| INV-11 | `activatedAt`, uma vez preenchido, nunca é limpo |
| INV-12 | `tenantId` consistente em todas as relações |
| INV-13 | **Toda** publicação exige `basePublishedVersionId === setup.publishedVersionId` — **sem exceção**, inclusive rollback, que clona e rebaseia (§4.6). A igualdade é **aplicada por compare-and-swap no ponteiro `AiSetup.publishedVersionId`**, não por comparação em memória (§4.1) |
| INV-14 | Marcação de validação exige `MessageTrace` **ligado à `Message`** (`assistantMessageId`), gravado pela API estrita `recordRequiredValidationTrace` (§10.2), em `owner_preview`, com outcome compatível |
| INV-15 | Worker sem `claimToken` válido não escreve |
| INV-16 | `editRisk` é sempre calculado no servidor |
| INV-17 | O contato no WhatsApp nunca recebe texto de estado interno |
| INV-18 | Campos estruturais são montados pelo servidor, não aceitos do agente |
| INV-19 | **Mudança da versão-base invalida a candidata pendente** — job, marcações e estado (§4.8) |
| INV-20 | **Artefatos e avaliações pertencem à geração corrente**; os da anterior são descartados |
| INV-21 | `superseded` é terminal — nenhuma versão sai dele |
| INV-22 | Trace com `assistantMessageId` não nulo é **evidência**: a poda não o apaga, e sua gravação nunca é best-effort |

---

## 16. Decisões

**Q1 — `adv-gac`:** `active` + `grandfathered` temporário (§8.2).
**Q2 — demo pública:** `public_demo` explícito; backfill publicado; falha fechado amigável.
**Q3 — reviewer:** string obrigatória e normalizada.
**Q4 — edição em `ready_to_test`:** sem edição leve.
**Q5 — ajuste avançado pelo revisor:** **fora da fatia 1** (§4.9, opção A).

---

## 17. Faseamento

| # | Etapa |
|---|---|
| 1 | **Corrigir `outOfScope`** — commit separado |
| 2 | Models, migration (4 tabelas + 4 colunas em `MessageTrace`), máquina de estados, `diff.ts` |
| 3 | Backfill dry-run + auditoria tenant a tenant |
| 4 | Questionário, autosave com CAS, submissão · **reavaliar prazo aqui** |
| 5 | Job com lease + comandos (`setup:processar`, `setup:revisar`) |
| 6 | Simulador sobre a candidata + identidade por versão/geração + trace ligado à mensagem |
| 7 | Avaliações com prova, aprovação, ativação, publicação, edição versionada, rollback por clonagem |
| 8 | `ExecutionMode` + efeitos da demo + gate em modo observação |
| 9 | Gate real |

---

## 18. Riscos

| # | Risco |
|---|---|
| R-1 | Simulador sobre a candidata muda o motor (`setupVersionId`) — coração da fatia |
| R-2 | Publicar apaga e recria a knowledge (INV-7); dizer na tela |
| R-3 | Capacidade dos agentes — §6.2; custo operacional |
| R-4 | Parser frouxo; mitigado por §6.7 |
| R-5 | **Migration**: testar em cópia, aplicar por `prisma migrate deploy` via `release.sh:59-94`, validar depois. `sqlite3` só para inspeção |
| R-6 | `ExecutionMode` toca todos os chamadores |
| R-7 | **Tamanho** — reavaliar prazo ao fim da etapa 4 |
| R-8 | Mudar a demo altera comportamento observável (§7.3) — cobrir com teste |
| R-9 | `generation` no `contactId` abre conversa nova por ciclo; sem purga no projeto, monitorar |
| R-10 | **Trace síncrono em `owner_preview`** (§10.2) põe uma escrita no caminho da resposta do simulador. É a única exceção ao "medição fora do caminho crítico"; justificada por ser evidência, não telemetria. Mitigado por não executar a poda nesse caminho |
| R-11 | **`@unique` em coluna de tabela existente e populada** (`MessageTrace.assistantMessageId`): conferir na migration gerada que nenhum backfill é tentado e que os `NULL` antigos convivem com o índice único |
| R-12 | **Retenção ilimitada da evidência.** Preservar todo trace com `assistantMessageId` (INV-22) resolve a prova, mas tira essas linhas da poda temporal — elas crescem sem limite na fatia 1. Aceitável para os 10 primeiros clientes; **monitorar quantidade e tamanho**. Política de descarte após supersede/ativação fica para uma fatia posterior, e **nunca** pode apagar a prova antes da marcação |

---

## 19. Critérios de pronto

| # | Critério observável |
|---|---|
| 1 | Tenant recém-criado não chama o provider — evidência: trace com `provider='nenhum'`, **sem etapa `brain` em `stepsJson`**, `outcome='setup_blocked'`, e o mock do provider não invocado no teste focal |
| 2 | QR pareado indevidamente não contorna o gate |
| 3 | **Job sobrevive ao processo**: matar `setup:processar`, recuperar o lease, rodar de novo e confirmar retomada do mesmo job **sem duplicar artefatos**. *(Retomada automática por restart só com `SETUP_WORKER_ENABLED=1`.)* |
| 4 | Retry não duplica artefatos nem `KnowledgeDoc` |
| 5 | Worker que perdeu o lease **não** grava |
| 6 | Isolamento entre tenants |
| 7 | Durante revisão de edição, a versão ativa atende com a config antiga |
| 8 | Alteração de horário publica **e cria versão**; snapshot nunca defasa |
| 8b | **Edição segura percorre somente a transição interna `— → active`**: a request não envia `origin`, `editRisk` nem `state`, e tentar enviá-los não altera o resultado |
| 9 | Alteração de preço não entra em produção até aprovação |
| 10 | Duas abas: a antiga recebe **409** no autosave **e** nas marcações |
| 11 | Nenhuma rota HTTP move para `ready_to_test` |
| 12 | Marcações sobrevivem ao reload |
| 13 | **Marcar sem executar é impossível**: sem trace ligado ao `assistantMessageId`, a marcação é rejeitada — inclusive com `HERMES_METRICS=0` (a API estrita ignora a flag) |
| 13b | **Evidência é idempotente**: repetir a gravação para a mesma `assistantMessageId` devolve o trace existente e **não** cria um segundo |
| 13c | **Falha da evidência não perde a resposta**: forçar erro no trace de validação → a resposta aparece na tela, a marcação fica desabilitada e a orientação é executar de novo |
| 13d | **A poda não apaga evidência**: rodar `pruneOldTraces` com retenção curta mantém os traces com `assistantMessageId` e as marcações continuam válidas |
| 14 | Geração 1 → correção → geração 2: histórico e marcações da 1 **não** valem na 2 |
| 15 | Simulação não cria lead/ticket/handoff; **a Central não recebe nada da demo** |
| 16 | Shadow mode observável pela consulta de §8.3 — mostra o que **teria** sido bloqueado |
| 17 | Publicação atômica |
| 18 | **Rollback por clonagem**: voltar de P3 para o conteúdo de P1 cria R1 publicada, P3 vira `superseded`, **P1 permanece intocada**, e a publicação passa por INV-13 sem exceção |
| 18b | **Rollback revalida o histórico**: um snapshot com tool que não existe mais é **recusado antes** de tocar produção, dizendo qual campo não passa |
| 18c | **Publicação concorrente**: duas publicações partindo da mesma base — a segunda falha com `StaleSetupVersionError` e **nada** é gravado por ela (config, knowledge e ponteiro inalterados) |
| 19 | **Candidata obsoleta não publica**: edição segura durante revisão pendente → a revisão vai a `needs_changes` com evento `base_changed` e **não** desfaz a alteração segura |
| 20 | **Não há dead-end**: "Liberar minha IA" leva a `active` e `/canais` aceita o pareamento |
| 21 | Dois revisores: o segundo `setup:revisar` recebe conflito e vê quem assumiu |
| 22 | `setup:revisar` **recusa** enquanto o job não estiver `completed` na geração corrente |
| 23 | Tenants legados funcionam após backfill, com `activatedAt` preenchido |
| 24 | Logs e eventos sem prompt, resposta crua ou PII |
| 25 | **Pessoa externa completa as quatro etapas sem ajuda técnica** |

---

## 20. Histórico

**Rev. 1 → 2:** três→quatro models · seis→sete estados · revisão de tenant ativo · telas antigas ·
`editRisk` no servidor · backoff `2^(attempts-1)` · `ExecutionMode` · taxonomia de falhas.

**Rev. 2 → 3:** worker desligado · telemetria do gate · `operationalEffects` na demo · resolução por
`setupVersionId` · identidade por versão · `validationResultsJson` · edição segura versionada ·
allowlist estrita · CAS no autosave · `claimToken` · migration por `release.sh` · `setup:revisar` ·
consistência de tenant · sanitização.

**Rev. 3 → 4:** `wouldAllow`/`enforced` (fim do `gate_disabled`) · `generation` ·
`basePublishedVersionId` · marcações ligadas à execução · "Liberar minha IA" · campos de risco em
somente leitura · invariantes restaurados · critério de retomada · claim de revisão · `superseded`
explícito · servidor monta a config · contagem da migration.

### Rev. 4 → 5

| # | Rev. 4 | Rev. 5 |
|---|---|---|
| 1 | Rollback republicava a versão antiga por §4.1 | **Impossível**: INV-13 abortaria (base antiga ≠ publicada atual). **Rollback clona** — `origin='rollback'`, `rollbackSourceVersionId`, base = publicada atual; `superseded → active` **removida** (§4.6, §3.6) |
| 2 | Exigia "trace correspondente" | **Não havia vínculo**: `MessageTrace` só tinha `conversationId`, e a gravação é `void` e desligável por `HERMES_METRICS=0`. **`assistantMessageId` no trace** + em `owner_preview` o trace é **aguardado e obrigatório** (§10.2, R-10) |
| 3 | §4.8 mandava a review para `needs_changes` | A transição **não existia** na máquina (só por job/interno/owner). Declaradas `submitted → needs_changes` e `ready_to_test → needs_changes` por **`system`**, motivo `base_changed` (§3.2, §4.8) |
| 4 | "a equipe faz os ajustes avançados" | **Sem mecanismo.** Opção A: revisor **não edita** o candidato; campos estruturais são políticas do servidor; customização avançada **fora da fatia 1**. Opção B registrada como futuro (§4.9, Q5) |
| 5 | §2.6 dizia 2 colunas; §7.7 definia 3 | **4 colunas** em `MessageTrace`, propagado para migration, faseamento, rollout e critérios (§2.6, §2.7) |
| 6 | Rollout consultava `wouldAllow` | Não é persistido. **SQL real** por `setupGateEnforced=0` + razões bloqueantes (§8.3) |
| 7 | Limpeza do ciclo não incluía `reviewNote` | Nota da geração anterior apareceria na nova. Incluído (§3.5) |
| 8 | `setup:revisar` só exigia `submitted` | Relógio mediria espera do job. Exige **job `completed` na geração corrente** + artefatos válidos + base válida (§11.1, critério 22) |
| 9 | "zero linhas de provider" | Não existe tabela de invocações. Evidência real: `provider='nenhum'`, sem etapa `brain`, `outcome='setup_blocked'`, mock não invocado (critério 1) |
| 10 | 18 invariantes | **21**: INV-13 sem exceção, INV-14 exige vínculo com a mensagem, INV-19 (base invalida pendente), INV-20 (geração corrente), INV-21 (`superseded` terminal) |

### Rev. 5 → 6

| # | Rev. 5 | Rev. 6 |
|---|---|---|
| 1 | "o trace é gravado com `await`, ignora `HERMES_METRICS=0`" | **`await` não torna obrigatório**: a função retorna cedo com a flag desligada, engole erro e devolve `void`. Uma implementação literal ficaria sem prova. API estrita **`recordRequiredValidationTrace`** — ignora a flag, propaga erro, devolve `traceId`, idempotente por `assistantMessageId`, sem poda; `recordMessageTrace` fica inalterada nos demais modos (§10.2) |
| 2 | `VALIDAR: basePublishedVersionId === publishedVersionId` | Comparação em memória **não é CAS** e admite TOCTOU. O ponteiro passa a ser tomado por `updateMany` condicional em `AiSetup.publishedVersionId`, com CAS também no estado da versão e no supersede da anterior; três caminhos com pré-condições distintas (§4.1). INV-13 declara a aplicação por CAS |
| 3 | Rollback clonava sem revalidar | Snapshot de meses atrás pode não passar no contrato atual. **Revalidação obrigatória** — `parseTenantConfig` atual, whitelist atual, knowledge não vazia, tenant, **diff exibido** e confirmação (§4.6) |
| 4 | 4 `@unique` | **5** — `MessageTrace.assistantMessageId @unique` garante uma evidência por resposta e sustenta a idempotência (§2.6, §2.7) |
| 5 | — | **Achado próprio:** `recordMessageTrace` dispara `pruneOldTraces` a cada N gravações, e a poda apagaria a evidência. A poda **preserva** traces com `assistantMessageId`, e a aprovação final **não revalida** contra o trace — confia em `validationResultsJson`, verificado uma vez na marcação (INV-22, critério 13d) |

### Rev. 6 → 6.1 (cirúrgica)

| # | Rev. 6 | Rev. 6.1 |
|---|---|---|
| 1 | §4.7 publicava a edição segura, mas §3.2 **não declarava a transição** — e "transições não listadas lançam" | Declarada **`— → active` por `system`**, com as cinco pré-condições e os efeitos; nota explícita de que não é `draft → active` e de que nenhum campo vem da request (§3.2). Critério focal 8b |
| 2 | `reviewVersionId === version.id` exigido **em prosa** na tabela | Movido para dentro do `where` do CAS, com a flag `publicaReview` distinguindo os três caminhos (§4.1) |
| 3 | API estrita sem exclusividade nem ordem de idempotência | **Um modo, um caminho** (`owner_preview` não chama o best-effort); idempotência por `create → P2002 → findUnique → validar`, nunca `find → create`; reutilização exige metadados compatíveis, senão **conflito** (§10.2) |
| 4 | INV-22 inserida entre INV-14 e INV-15 | Movida para o fim da tabela |
| 5 | — | **R-12**: preservar evidência da poda cria retenção ilimitada. Aceitável nos 10 primeiros; monitorar; política de descarte em fatia posterior |
