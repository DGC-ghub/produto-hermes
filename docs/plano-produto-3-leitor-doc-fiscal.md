# Plano — Produto #3: Leitor de Doc Fiscal

> **Terceiro produto do Hermes.** Depois do #1 (Atendente WhatsApp) de pé e do #2
> (Coletor de Documentos) recebendo e guardando o arquivo, o #3 é a camada de
> **leitura**: o cliente manda um documento (DARF/guia, nota fiscal de serviço,
> extrato, contrato — PDF ou foto), e o Hermes **classifica** o tipo, **extrai** os
> campos estruturados, **valida** e **resume em linguagem humana** ("Isto é um DARF de
> R$ X vencendo em Y").
>
> **Cliente-âncora:** Prestacon Contabilidade. É onde RAG + LLM brilham e o valor
> percebido é altíssimo — e também onde o erro tem custo real (verdade contábil).
>
> Ordem geral dos produtos: #1 Atendente → #2 Coletor de documentos → **#3 Leitor de doc fiscal**.
> O #3 só faz sentido depois que existir arquivo guardado (o #2) ou um ingest mínimo próprio.

---

## 1. O problema (e o princípio)

Escritório contábil recebe pilha de documento por WhatsApp e **digita à mão** o que
está neles: código do DARF, competência, valor, vencimento, CNPJ. É trabalho lento,
repetitivo e sujeito a erro — e um valor/vencimento/CNPJ errado tem **custo fiscal
real** (multa, guia paga errada, imposto no mês trocado). O #3 lê o documento e propõe
esses campos já estruturados, mas nunca sozinho vira verdade.

**Princípio (o mesmo do #1 e #2, sem exceção):** a **IA PROPÕE os campos** (JSON); o
**balcão VALIDA deterministicamente** (formato de CNPJ, valor numérico, data/vencimento
plausível, competência) antes de aceitar; extração fiscal é **verdade contábil —
nunca confiada ao prompt** — e passa por **confirmação humana** (estado `aprovado`)
antes de virar dado do escritório. A IA nunca toca o banco; os guard-rails são código
determinístico, não instrução de prompt.

---

## 2. Relação com o #2 (não duplicar)

O #3 **se apoia** no #2. O #2 é quem **recebe e guarda** o arquivo: o model `Document`
planejado em `docs/plano-produto-2-coletor-documentos.md §3`
(`Document { tenantId, contactId, filePath, mimeType, fileSize, documentType, status… }`),
gravado em path isolado por tenant (`data/documents/<tenantId>/<contactId>/<id>.<ext>`,
`chmod 700`, fora do Git). O #3 **lê esse arquivo já guardado** e preenche a extração.

- **Se o #2 já existe:** o #3 consome `Document` — recebe `documentId`, lê `filePath`
  do disco, extrai, valida, e liga o resultado ao `DocumentRequestItem` (o checklist do
  #2). A classificação de tipo (`classifyDocumentType`, puro, planejada no #2 §7) já
  entrega o `documentType` que decide **qual schema de extração** aplicar (§8).
- **Se o #2 ainda NÃO existe:** o #3 precisa de um **ingest mínimo próprio** — uma tela
  interna (`requireOperator`) onde o operador sobe o arquivo. Aqui **reusa a validação de
  tamanho/MIME e a escrita** do padrão já provado
  (`transcribeUploadedAudio`, `app/lib/audio/upload.server.ts:14`), **mas com uma
  diferença crítica: NÃO descarta o arquivo.** O padrão do áudio grava num `tmpdir` e
  apaga tudo num `finally` (`rm(dir, { recursive: true, force: true })`, linha 33) porque
  é transcrever-e-jogar-fora. Um documento fiscal precisa **persistir** — o arquivo tem
  que sobreviver até o operador aprovar/rejeitar e virar trilha de auditoria (LGPD, §10).
  Então o ingest do #3 grava no **mesmo path persistente e isolado do `Document` do #2**
  (`data/documents/<tenantId>/<contactId>/<id>.<ext>`, `chmod 700`, fora do Git), **não**
  num `tmpdir` descartável. Reusa a validação de upload; **não** reusa o descarte.
  **Não** construir o webhook de mídia, o checklist, nem o agendador do #2 aqui — isso é
  escopo do #2. O ingest do #3 é só "botar um arquivo pra dentro pra ter o que ler".

**Regra de fronteira:** o #3 **não** recebe mídia da Meta nem persegue documento — isso
é #2. O #3 só adiciona **leitura/extração** sobre um arquivo que já está guardado. Se o
#2 for construído depois, o ingest próprio do #3 é aposentado em favor do `Document` do
#2 (a extração passa a apontar pra ele por `documentId`).

---

## 3. A decisão central de infra — COMO o modelo LÊ o documento

Este é o coração técnico do #3 e onde está o gasto real. Hoje o cérebro é **texto puro**:
`buildPrompt` (`app/lib/attendant/providers/claude-cli.server.ts:21`) devolve uma
**string**, e `runClaude` faz `spawn('claude', …)` escrevendo o prompt no `stdin`. **Não
passa PDF, imagem nem anexo.** Só existem dois providers (`claude_cli`, `mock`); **não
existe `anthropic_api`**. E **não há nenhuma lib** de PDF/OCR/visão no `package.json`
(nem `pdf-parse`, `pdfjs`, `tesseract`, `sharp`, `mammoth`, `xlsx`). Portanto "ler
documento" **não é plugável no cérebro atual** — exige uma das três rotas abaixo.

> **Governança de dados vale para a rota grátis também — não só para a paga.** O provider
> `claude_cli` roda `claude -p` com a **conta Claude logada na máquina**
> (`claude-cli.server.ts:78`, `env: { ...process.env }`; a memória do projeto confirma
> "usa a conta logada"). Isso significa que, nas rotas (a) e (c) via `claude_cli`, o
> **conteúdo do documento** (CNPJ, valores, dados bancários de extrato) é enviado aos
> servidores da Anthropic através dessa conta pessoal/logada. "Grátis" **não** é
> equivalente a "local/privado": mandar documento fiscal real de cliente por ali é, por
> si só, uma questão de **base legal, consentimento e termos da conta usada** — a avaliar
> **antes** de por documento real por ali, exatamente como na rota paga (c). Ver §10.

### (a) Extrair TEXTO do PDF por lib — grátis, só PDF digital
Lib nova (`pdf-parse` / `pdfjs`) extrai o texto de um **PDF nativo/digital** (gerado por
software: DARF do e-CAC, NFS-e do portal). Esse texto vira mais um bloco no `buildPrompt`,
e o cérebro atual (`claude_cli`, texto-puro) já consegue propor os campos.
- **Prós:** grátis (usa o CLI logado, sem API paga); reusa o cérebro atual quase inteiro;
  ótimo pros documentos fiscais mais comuns, que **são** PDF digital.
- **Contras:** **não serve foto nem PDF escaneado** (imagem → texto vazio); perde layout,
  QR-code de verificação e dados posicionais. **Texto digital ≠ texto bem-ordenado:** PDFs
  fiscais brasileiros frequentemente têm layout em colunas/tabelas onde a ordem de leitura
  do texto extraído vem **embaralhada** (valor separado do rótulo, competência fora de
  ordem). Ou seja, o risco de dígito trocado / campo cruzado existe **também** na rota (a),
  não só no OCR (b) — a validação determinística (§6) e a confirmação humana são
  **igualmente obrigatórias** aqui; não relaxar o guard-rail por "ser PDF digital limpo".
  Lib nova = **perguntar antes** (princípio do projeto).

### (b) OCR pra imagem/foto — grátis-ish, lento e menos preciso
Lib/serviço novo (`tesseract.js`, ou um binário/serviço de OCR) transforma foto/PDF
escaneado em texto, que segue o caminho (a).
- **Prós:** cobre o caso "cliente tirou foto do papel" sem API paga.
- **Contras:** **lento** (segundos por página, agrava a latência que já é gargalo — a
  memória do projeto registra ~17s no motor real), **impreciso** em foto torta/borrada, e
  o erro de OCR num dígito de valor/CNPJ é justamente o risco fiscal. Dependência pesada
  nova = **perguntar antes**.

### (c) API Anthropic com leitura nativa de PDF/imagem — paga, precisa, mas não existe hoje
Os modelos Claude via **API Anthropic** leem PDF e imagem **nativamente** (document/vision)
e suportam **saída estruturada** (tool use). É o caminho tecnicamente natural pra "ler
documento", inclusive foto e PDF escaneado, num passo só.
- **Prós:** cobre todos os formatos (digital, escaneado, foto); melhor qualidade; saída
  estruturada casa com o padrão "IA propõe JSON validado".
- **Contras:** **é paga** e **não há provider dela hoje** — exige criar
  `app/lib/attendant/providers/anthropic-api.server.ts` (novo), `@anthropic-ai/sdk`
  (**perguntar antes**) e env `ANTHROPIC_API_KEY` (hoje só existe `CLAUDE_MODEL`).
  Contradiz o princípio de produto **"grátis antes de paga"** (memória do projeto: Fase 2
  = refinar no `claude_cli`/whisper local **antes** de virar pra `anthropic_api`).

### Recomendação honesta (faseada, "grátis antes de paga")
1. **Começar por (a)** — PDF digital via `pdf-parse`, reusando o cérebro `claude_cli`
   atual. Cobre o grosso dos documentos fiscais (DARF, NFS-e, guia, muitos extratos) com
   custo zero de API. É o menor passo pra provar valor.
2. **Só então (c)** — provider `anthropic_api` com visão nativa, quando o valor estiver
   **comprovado** e o custo justificar (foto/escaneado forem realmente necessários e o
   cliente pagar). Ligar por env, sem tocar no resto: `resolveProvider`
   (`app/lib/attendant/index.ts`) já escolhe por `ATTENDANT_PROVIDER`.
3. **(b) OCR** só se aparecer volume real de foto **e** não quisermos pagar API — é o pior
   trade-off (lento + impreciso onde o erro é caro). Tratar como plano C, não como etapa.

> A validação determinística dos campos (§6) é **a mesma** nas três rotas — é ela que
> segura a verdade contábil, independentemente de como o texto/visão chegou ao modelo.
> (Atenção: "a mesma nas três rotas" vale **depois** de escritos os validadores fiscais;
> não são "os mesmos que já existem hoje" — ver §4.)

---

## 4. O que REUSA vs. o que é NOVO (honesto)

### Reusa (confirmado no código)
- **Orquestração** — `processIncomingMessage` (`app/lib/conversation.server.ts:65`)
  resolve tenant, reusa conversa por `contactId`, monta contexto, chama o cérebro, valida
  e persiste com isolamento. O documento muda o **conteúdo** do inbound, não a orquestração.
- **Cérebro plugável + fallback seguro** — `resolveProvider`/`generateAttendantReply`
  (`app/lib/attendant/index.ts:24`). Provider novo é **arquivo novo**; o dispatcher não muda.
- **O MOLDE (não os validadores) de validação em cascata** — `validateAttendantOutput`
  (`app/lib/attendant/validate.ts`): guard-rails globais + policy do tenant, saneamento em
  cascata (ação inválida vira `null` sem derrubar a `reply`). É o **padrão/estrutura** que
  reusamos pros validadores fiscais — **não** as funções em si.
- **Config declarativa por tenant** — `TenantConfig` (`app/lib/attendant/tenant-config.ts:28`)
  com `parse`/`serialize`/`save`. É onde entra a `fiscalExtractionPolicy` (§8), mesmo padrão.
- **Isolamento `(tenantId, contactId)`** — `@@index([tenantId, contactId])` do Ticket
  (`prisma/schema.prisma:129`) é o molde do model de extração (§5).
- **Função pura determinística como estilo** — `extractLeadPatch` (`app/lib/lead.ts:57`)
  é o molde de `classifyDocumentType` (planejado no #2) e dos validadores fiscais.
- **Histórico do contato** — `db.message.findMany` no `processIncomingMessage` permite
  contextualizar ("já vimos esse CNPJ? qual foi o resultado?").

### Novo — e por que NÃO é "só plugar no cérebro atual"
Ser honesto: o cérebro de hoje é **só-texto** e só sabe propor **uma** ação, o literal
`abrir_chamado`. Confirmado:
- `AttendantAction` (`app/lib/attendant/types.ts:47`) é **um único tipo literal**
  `{ type: 'abrir_chamado'; subject; description; category? }` — **não** é enum extensível.
- `validateAction` (`app/lib/attendant/validate.ts:92`) **hardcoda**
  `raw.type !== 'abrir_chamado'` → retorna `null` pra qualquer outro `type`.
- `ToolName` (`tenant-config.ts:15`) só conhece `abrir_chamado | consultar_chamados | pedir_agendamento`.
- `buildPrompt`/`runClaude` **não passam arquivo** — é `stdin` de string.

Logo, o trabalho novo do #3 é:
1. **Rota de leitura** (§3) — extrair texto de PDF (a) e/ou provider `anthropic_api` (c).
2. **Ação estruturada de extração** — transformar `AttendantAction` em **union
   discriminada** e **reescrever `validateAction` como `switch (type)`**, adicionando
   `extrair_documento`. Isto é **refactor real**, não "mudança pequena":
   `validateAttendantOutput` está hoje acoplado ao shape fixo do `AttendantOutput` e
   `validateAction` hardcoda `abrir_chamado`. **Este é o mesmo refactor de porte médio já
   descrito no #2 §2-bis-a** — se o #2 já o fez, o #3 só **adiciona uma variante**; se não,
   o #3 paga esse custo.
3. **Validadores fiscais puros — CÓDIGO NOVO** — `validateCNPJ` (com **dígito verificador**),
   `isValidDate`/`isPlausibleDueDate`, `parseFiscalValue`, `isCompetencia`. São
   determinísticos e testáveis, mas **não existem hoje** — não confundir com "os mesmos
   validadores" do `validate.ts`. O que se reusa é o **molde em cascata**, não estas funções.
4. **Model de extração** (§5) e **schema de campos por tipo** (§6, §8).
5. **Estender `AttendantInput`** com metadados/texto do documento (`documentText?` /
   `documentPath?`) — mudança pequena, mas real.

---

## 5. Modelo de dados

Uma extração aponta pra **um `Document`** (o arquivo do #2). Segue o isolamento
`(tenantId, contactId)`, igual a todo model existente.

### `DocumentExtraction` — o que a IA leu do arquivo, validado e (des)aprovado

| campo | tipo | nota |
|---|---|---|
| `id` | String @id | cuid |
| `documentId` | String | FK ao `Document` do #2 (ou ao ingest próprio do #3) |
| `tenantId` | String | isolamento |
| `contactId` | String | isolamento (do `wa_id`, **nunca** default `demo-user`) |
| `docType` | String | `darf` \| `guia` \| `nota_servico` \| `extrato_bancario` \| `contrato` … (decide o schema de campos) |
| `fieldsJson` | String (JSON) | campos extraídos **já validados** (ex.: `{ codigo, competencia, valor, vencimento, cnpj }`) — **contém PII fiscal**, ver §10 |
| `status` | String | `extraido` → `validado` → `aprovado` \| `rejeitado` |
| `isCurrent` | Boolean | `true` na extração corrente do documento; propostas antigas ficam `false` (ver constraint abaixo) |
| `confidence` | Float | confiança da proposta [0,1] (clampada, como já se faz no `validate.ts`) |
| `rejectionReason` | String? | por que o operador ou o balcão rejeitou (inclui "faltou campo obrigatório X", §6) |
| `provider` | String? | `claude_cli` / `pdf_text` / `anthropic_api` — pra auditar de onde veio |
| `createdAt` / `updatedAt` | DateTime | |

Índices: `@@index([tenantId, contactId])`, `@@index([documentId])`.

**Constraint — decisão explícita (histórico de propostas preservado, para auditoria):**
**NÃO** usar `@@unique([documentId])`. Para verdade contábil auditável, jogar fora a
extração anterior (rejeitada/reprovada) ao re-extrair perderia a trilha de "o que a IA
propôs antes e por que foi rejeitado". Então: **várias `DocumentExtraction` por
`documentId`**, ordenadas por `createdAt`, com o flag `isCurrent` marcando a proposta
corrente. Re-extração **insere uma nova linha** e vira `isCurrent=true`, marcando as
demais `isCurrent=false` — nada é destruído. (A alternativa — manter `@@unique` e mandar o
histórico para uma tabela de auditoria separada — foi descartada por ser mais complexa sem
ganho; não afirmar as duas ao mesmo tempo.)

**Estados (transições determinísticas, no balcão):**
`extraido` (IA propôs) → `validado` (passou nos validadores fiscais determinísticos **e**
todos os campos `required` do schema presentes — ver §6) → `aprovado` (operador confirmou —
só aqui vira verdade contábil) **ou** `rejeitado` (validação falhou, faltou campo
obrigatório, confiança baixa, ou operador recusou → volta pra reprocessar/escala).

---

## 6. Extração como PROPOSTA VALIDADA

A IA propõe uma ação `extrair_documento`; o balcão a valida **campo a campo** antes de
aceitar. Molde exato: o `validateAction`/cascata que já existe (`validate.ts:92`), onde
proposta inválida vira `null` sem derrubar a `reply`.

### Ação proposta (nova variante da union discriminada)
```ts
type AttendantAction =
  | { type: 'abrir_chamado'; subject: string; description: string; category?: string } // atual
  | { type: 'extrair_documento'; docType: string; fields: Record<string, unknown> }    // novo
```

### Validação determinística (no balcão, nunca no prompt)
`validateFiscalExtraction(raw, policy)` — descarta **campo inválido** (vira ausente),
não a resposta inteira:
- **`docType`** — precisa estar em `fiscalExtractionPolicy.acceptedDocTypes` do tenant.
- **`cnpj`** — `validateCNPJ`: máscara/formato **+ dígito verificador**; rejeita CNPJ
  zerado/fake. Inválido → campo cai.
- **`valor`** — `parseFiscalValue`: número > 0, dentro de `valueRange` do tenant se
  definido; `NaN`/negativo → cai.
- **`competencia`** — `isCompetencia`: `/^\d{4}-\d{2}$/` e mês plausível.
- **`vencimento`/data** — `isPlausibleDueDate`: data ISO válida, dentro de uma janela
  razoável (nem no passado remoto nem anos no futuro).
- **`codigo`** (DARF) — casa a lista de códigos aceitos do tenant, se houver.

### Regra do campo obrigatório descartado (tensão resolvida)
Há uma tensão real: a cascata **descarta campo inválido** (vira ausente), mas o schema do
tipo define campos `required` (ex.: DARF → `valor`, `vencimento`, `cnpj`). **A regra é:**
se, **após** a validação campo a campo, **qualquer campo em `schemas[docType].required`
ficou ausente ou foi descartado**, a extração **NÃO vai para `validado`** — vai para
`needsHuman` / `rejeitado` com `rejectionReason` explicando qual obrigatório faltou. Isto
espelha exatamente o comportamento do `validateAction` (`validate.ts:118-131`), que retorna
`null` a **ação inteira** quando falta um `requiredField`. Aqui o análogo de "retornar null
à ação" é **não promover a `validado`** — o essencial (os `required`) tem que estar
presente e válido; se não está, escala pro humano, não passa como validada.

### Confiança e confirmação humana
- `confidence` é **clampada [0,1]** (mesmo tratamento do `validate.ts`).
- Abaixo de um limiar (`fiscalExtractionPolicy.minConfidence`), **não** vira `validado`
  automático — **escala pra humano** (fallback seguro, como o motor já faz).
- **Nada vira verdade contábil sem `aprovado`** — o operador confirma na tela. A IA
  propõe; o balcão valida; o humano assina embaixo.

Testes espelham `validate.test.ts`: "valida extração com campos válidos", "descarta CNPJ
inválido sem perder a reply" e **"não promove a `validado` quando falta campo obrigatório"**.

---

## 7. Fluxo ponta a ponta

1. **Documento recebido** — do `Document` do #2 (ou do ingest interno do #3). Já está em
   disco isolado por tenant.
2. **Classifica o tipo** — `classifyDocumentType` (puro, por nome/MIME/patterns do tenant,
   reuso do #2 §7). Define **qual schema de extração** aplicar. Se não resolver, a IA
   propõe o `docType` e o operador confirma.
3. **Lê o conteúdo** — pela rota escolhida (§3): (a) extrai texto do PDF digital → bloco
   no prompt; ou (c) passa o arquivo ao provider `anthropic_api` (visão nativa).
4. **Extrai os campos pelo schema do tipo** — a IA propõe `extrair_documento { docType, fields }`
   seguindo o schema daquele tipo (§8).
5. **Valida** — `validateFiscalExtraction` (§6) aplica os validadores determinísticos;
   campos inválidos caem; **`status='validado'` só se passou E todos os `required` estão
   presentes** (senão escala/rejeita, §6).
6. **Resume em linguagem humana — mas SEM vazar dado não-confirmado ao cliente.** O resumo
   com **valores concretos** ("Isto é um **DARF** de **R$ 1.240,00**, código **1240**,
   competência **06/2026**, vencimento **20/07/2026**, CNPJ **XX**") é da **TELA INTERNA do
   operador** (`/atendente`), para conferência — **não** é, por padrão, o texto enviado ao
   cliente pelo WhatsApp. Motivo: enquanto a extração está `validado` (não `aprovado`), os
   campos ainda são **proposta não-confirmada**; ecoar valor/CNPJ/vencimento por um canal
   externo antes da aprovação humana pode (a) vazar dado ainda não validado e (b) — se a
   extração cruzou campos — vazar dado de **outro CNPJ**. A `reply` ao cliente, se houver,
   é genérica ("recebi seu documento, já já te confirmo") ou vem **após** `aprovado` e com
   cuidado de não expor dados de terceiros. Não tratar reply-ao-cliente e
   resumo-de-conferência como o mesmo texto.
7. **Preenche o checklist/dossiê** — liga a extração ao `DocumentRequestItem` do #2 (marca
   o item como recebido/lido) e mostra no dossiê (`composeDossier`) da tela `/atendente`.
8. **Escala dúvida/baixa confiança** — confiança < limiar, algum `required` ausente, ou
   tipo não reconhecido → `needsHuman=true`, entra na fila pra o operador conferir e
   `aprovar`/`rejeitar`.

---

## 8. Templates de extração por tipo de documento (config por tenant)

Que campos por tipo — contabilidade primeiro. É **dado**, não código: mesmo padrão
declarativo do `TenantConfig`, com uma `fiscalExtractionPolicy` opcional (espelha a
`documentPolicy` do #2 §7 e é validada por `parseTenantConfig`).

**DARF / guia** → `{ codigo, competencia, valor, vencimento, cnpj }`
**Nota fiscal de serviço (NFS-e)** → `{ numero, dataEmissao, valor, cnpjPrestador, cnpjTomador, iss? }`
**Extrato bancário** → `{ banco, agencia, conta, periodo, saldoInicial, saldoFinal }`
(itens de lançamento são fase posterior — extrair só o cabeçalho/saldo primeiro)
**Contrato** → `{ partes, objeto, vigencia, valor? }` (menos crítico; sem validação fiscal dura)

```jsonc
// trecho de config/tenants/prestacon.json
"fiscalExtractionPolicy": {
  "acceptedDocTypes": ["darf", "guia", "nota_servico", "extrato_bancario"],
  "minConfidence": 0.6,
  "valueRange": { "min": 0, "max": 10000000 },
  "schemas": {
    "darf":        { "required": ["valor", "vencimento", "cnpj"], "optional": ["codigo", "competencia"] },
    "nota_servico":{ "required": ["numero", "valor", "cnpjPrestador"], "optional": ["dataEmissao", "cnpjTomador"] },
    "extrato_bancario": { "required": ["periodo"], "optional": ["banco", "saldoInicial", "saldoFinal"] }
  }
}
```

**Outras verticais entram só por config** — troca `acceptedDocTypes`/`schemas` no
`<slug>.json`, sem tocar código. Os validadores puros (`validateCNPJ`, `parseFiscalValue`,
datas) são genéricos e reusados por qualquer tenant; só o **schema de quais campos** muda
por config.

---

## 9. Etapas de entrega

### Etapa 0 — Baseline honesto (o que já existe)
Não recomeçar: orquestração, cérebro plugável + fallback, validação em cascata, config
declarativa, isolamento `(tenantId, contactId)`, dossiê+fila. **Pronto:** confirmado que
existe um arquivo pra ler — o `Document` do #2 **ou** a decisão de fazer o ingest mínimo
próprio do #3.

### Etapa 1 — Validadores fiscais puros (grátis, sem infra)
`validateCNPJ` (formato + dígito verificador), `parseFiscalValue`, `isCompetencia`,
`isPlausibleDueDate` — funções puras **novas**, estilo `extractLeadPatch`, cada uma com
teste. **Pronto:** os validadores rejeitam CNPJ fake, valor negativo, data implausível e
competência malformada, tudo coberto por teste — independente de qualquer LLM.

### Etapa 2 — Ação estruturada de extração (refactor médio, §4.2)
Transformar `AttendantAction` em union discriminada; reescrever `validateAction` como
`switch (type)`; adicionar `extrair_documento` + `validateFiscalExtraction` (incluindo a
**regra do `required` ausente → não-`validado`**, §6); estender `ToolName`; atualizar
prompt/schema do provider e os testes de `validate.ts`.
*(Se o #2 já fez a união, aqui é só **adicionar a variante**.)*
**Pronto:** dado um JSON de extração cru, o balcão valida campo a campo, descarta os
inválidos sem derrubar a `reply`, **não promove a `validado` quando falta obrigatório**, e
só emite `extrair_documento` se a tool estiver habilitada pro tenant — coberto por teste.

### Etapa 3 — Model + config + tela de conferência
`DocumentExtraction` no schema (`prisma migrate dev`), **sem `@@unique([documentId])`**, com
`isCurrent` (§5); `fiscalExtractionPolicy` no `TenantConfig` (parse validado); tela interna
(`requireOperator`) que lista extrações `validado`, mostra os campos (é **aqui** que vai o
resumo com valores concretos, §7.6) e permite `aprovar`/`rejeitar`. **Pronto:** o operador
vê uma extração proposta, os campos validados, e consegue aprová-la (vira verdade) ou
rejeitá-la, isolado por tenant.

### Etapa 4 — Rota de leitura (a): texto de PDF digital (grátis) ⭐ primeiro valor
Adicionar `pdf-parse` (**perguntar antes**); função que extrai texto do `filePath`;
estender `AttendantInput`/`buildPrompt` com o bloco de texto do documento; a IA propõe
`extrair_documento` a partir do texto. **Ingest mínimo próprio se o #2 não existir —
persistindo o arquivo em `data/documents/<tenantId>/<contactId>/<id>.<ext>` (`chmod 700`,
fora do Git), NÃO em `tmpdir` descartável** (§2). **Cuidado explícito de PII no prompt:** o
bloco `documentText` no `buildPrompt` — que carrega CNPJ, valores, dados bancários brutos —
**NÃO deve ser logado nunca**, nem sob `ATTENDANT_DEBUG`. A disciplina atual do
`claude_cli` (`claude-cli.server.ts:10-13`) só protege a **saída** (reply/leadPatch); o
**input-documento** é novo e precisa da sua própria disciplina de não-log. **Antes de por
documento fiscal real de cliente por aqui, avaliar a base legal/consentimento da conta
Claude logada** (§3, §10). **Pronto:** o operador sobe (ou o #2 entrega) um **PDF digital
de DARF**, o Hermes extrai `{codigo, competencia, valor, vencimento, cnpj}`, valida, resume
na tela interna e grava `DocumentExtraction` `validado` — sem API paga, sem logar o
conteúdo do documento.

### Etapa 5 — Ligar ao checklist/dossiê do #2
Amarrar a extração ao `DocumentRequestItem`; dossiê mostra o que foi lido; `/atendente`
prioriza extração pendente de conferência. **Pronto:** ao ler um documento, o item do
checklist do #2 reflete "recebido e lido", e o operador vê no dossiê do contato os campos
extraídos.

### Etapa 6 — Provider `anthropic_api` com visão (pago, quando o valor justificar) ⭐ marco
Criar `app/lib/attendant/providers/anthropic-api.server.ts` (**`@anthropic-ai/sdk`,
perguntar antes**), env `ANTHROPIC_API_KEY`; `AttendantInput` com `documentPath?`; ligar
por `ATTENDANT_PROVIDER=anthropic_api`; saída validada pelos **mesmos validadores fiscais
das Etapas 1/2** (agora sim "os mesmos", porque já escritos — vale **entre as rotas
(a)/(b)/(c)**, não em relação ao que existia antes do #3). **Pronto:** o Hermes lê
**foto/PDF escaneado** de DARF/NFS-e via visão nativa, extrai e valida com a mesma barra de
qualidade, e o custo por documento é medido/logado.

### Etapa 7 — Operação (LGPD, retenção, auditoria)
Retenção/expiração do documento **e** do `fieldsJson` da extração (dado sensível: CNPJ,
valores, dados bancários) com acesso restrito; log de proveniência (`provider`,
`confidence`) — **sem** logar o conteúdo do documento; relatório "quantos documentos
lidos/aprovados no mês". **Pronto:** há política de retenção aplicada ao arquivo e à
extração e um relatório de leitura por competência, com trilha de quem aprovou.

### Definição de Pronto do #3
O cliente da Prestacon manda um documento fiscal (via #2 ou ingest interno); o Hermes
**classifica o tipo, extrai os campos pelo schema daquele tipo, valida deterministicamente
(CNPJ, valor, data, competência), resume em linguagem humana na tela do operador e escala
baixa confiança / obrigatório faltando** — e **nada vira verdade contábil sem o operador
aprovar**. Começa grátis (PDF digital via `claude_cli`) e sobe pra visão paga
(`anthropic_api`) só com valor comprovado. Um segundo escritório entra **só por config**
(`acceptedDocTypes` + `schemas` no `<slug>.json`).

---

## 10. Riscos

- **Extração errada = risco fiscal.** Valor/vencimento/CNPJ errado tem custo real (multa,
  guia paga errada, imposto no mês trocado). O risco existe **igual na rota (a)** — mesmo
  PDF digital pode vir com layout de tabela embaralhado (valor cruzado com outro rótulo,
  competência fora de ordem), não só no OCR. Mitigação: validação determinística
  (dígito verificador de CNPJ, faixa de valor, competência, data) **+** confirmação humana
  obrigatória (`aprovado`) antes de virar verdade; limiar de confiança que escala em vez de
  adivinhar. **Não relaxar o guard-rail por "ser PDF digital limpo".**
- **PII do documento no prompt/log (input, não só output).** DARF/NFS-e/extrato carregam
  CNPJ, valores, dados bancários. A disciplina atual do `claude_cli`
  (`ATTENDANT_DEBUG`, `claude-cli.server.ts:10-13`) protege a **saída** (reply/leadPatch
  que ecoam PII do cliente) — **não** o texto do documento, que na rota (a) é concatenado
  inteiro no `buildPrompt` e passado via `stdin` ao subprocesso. Mitigação concreta: o
  bloco `documentText` do prompt **nunca é logado** (nem sob `ATTENDANT_DEBUG`); o
  `fieldsJson` persistido **é PII fiscal** e precisa de **retenção/expiração e acesso
  restrito** (§7 Etapa 7).
- **Governança de dados da conta Claude logada (a rota grátis não é "local/privado").** Nas
  rotas (a)/(c) via `claude_cli`, o conteúdo do documento vai aos servidores da Anthropic
  através da **conta logada na máquina** (`claude-cli.server.ts:78`). Antes de por documento
  fiscal **real** de cliente por ali, **avaliar base legal, consentimento e os termos da
  conta usada** — independentemente de ser grátis. "Grátis" ≠ "sem custo de governança".
- **Custo de visão/API.** A rota (c) é paga por documento/página; foto grande e PDF longo
  custam mais. Por isso o faseamento "grátis (a) antes de paga (c)", com custo medido/logado
  por documento antes de liberar em escala.
- **Documento ilegível / foto ruim.** Foto torta, borrada ou com reflexo derruba OCR e
  confunde visão. Mitigação: baixa confiança → escala pra humano com "reenvie a foto mais
  nítida" (a IA redige, o balcão decide); nunca chutar campo.
- **PDF escaneado sem OCR.** A rota (a) devolve **texto vazio** pra PDF escaneado/foto —
  falha silenciosa se não detectada. Mitigação: detectar "texto extraído vazio/curto
  demais" e **escalar** (ou cair pra rota (c)), nunca tratar vazio como "documento sem dados".
- **Latência.** O motor real já é lento (~17s, gargalo nº1 na memória do projeto); somar
  OCR (rota b) piora muito. Preferir (a)/(c); extração pode ser **assíncrona** (processa e
  avisa depois) em vez de bloquear a conversa.
- **Dependências fora da stack.** `pdf-parse`, `tesseract.js`, `@anthropic-ai/sdk` são
  todas libs novas — **perguntar antes** (princípio do projeto), nenhuma entra sem decisão
  explícita.