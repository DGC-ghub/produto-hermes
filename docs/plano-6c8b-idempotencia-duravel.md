# 6C.8B — idempotência durável do WebhookEvent

> **Plano, não implementação.** Nenhuma migration criada, nenhum código alterado.
> Rev. 2 — revisada em 2026-08-11 sobre o `HEAD 1f34af8`, com nove correções sobre a rev. 1.
> Decisões do dono: **A aprovada** (ambíguo nunca é repetido automaticamente),
> **B revisada** (deploy único ao fim da 6C.8B, sem deploy intermediário),
> **C adiada** (webhook de status da Meta só depois do `providerMessageId`).

---

## 1. O que está acontecendo

Quando um cliente manda mensagem no WhatsApp, o Hermes grava o evento, roda o motor e responde.
Se o processo morrer no meio — queda de energia, restart, o Pi travando — o evento volta para a
fila e **o trabalho inteiro é refeito do zero**.

## 2. Problema e impacto

O sistema não guarda onde parou. Refazer do zero significa: o cliente **aparece falando duas
vezes** na tela do atendente, o cérebro é **pago de novo**, o chamado pode duplicar e **o cliente
pode receber a mesma resposta duas vezes**.

Há um caminho pior, já reconhecido pelo próprio código: quando o Hermes responde o cliente mas
falha ao marcar o evento como concluído, ele loga "CRÍTICO" e segue. Dez minutos depois a faxina
devolve o evento para a fila — e tudo acima acontece com o cliente **já respondido**.

E há um terceiro, que não depende de crash nenhum: **o operador duplica a mensagem com as
próprias mãos** (§4).

## 3. Gabriel precisa decidir?

**Não** — as três decisões foram tomadas. Falta autorizar o **spike do Baileys** (§5) quando
chegarmos nele, e a **migration** quando o passo 4 começar.

## 4. Recomendação

Começar pelo tipo de retorno do envio. É o passo que destrava todos os outros, não precisa de
migration, e sozinho já fecha dois caminhos de duplicação.

## 5. Estado da etapa

Plano revisado. Passo 1 **liberado**.

---

# O diagnóstico

## O que a fila protege, e o que não protege

Protege a **chegada**: o evento é gravado antes do `200` e o reenvio da Meta não duplica
(`messageId` é `@unique`); o claim é atômico e usa CAS.

Não protege nada depois. O único marcador de progresso é `status`, com quatro valores. Entre
"peguei" e "terminei" cabe o fluxo inteiro, e **nada deixa rastro no evento** — ele não guarda
nem o id da conversa que criou. A faxina de órfãos, **único** caminho de saída de `processing`,
decide olhando só a idade do `claimedAt`: não distingue "morreu antes de fazer nada" de "morreu
depois de responder o cliente".

## O inventário do que duplica

| O que | Idempotente hoje? | Quem vê a duplicata |
|---|---|---|
| Conversa | ✅ chave única | — |
| `Lead` | ✅ `upsert` por conversa | — |
| `Ticket` | ⚠️ dedup **heurístico** por assunto | operador |
| `Message` do cliente | ❌ | **operador** |
| `Message` do assistente | ❌ | operador |
| `HandoffEvent` | ❌ | operador |
| `MessageTrace` | ❌ | o número que mede o produto |
| **Alarme sensível / degradação** | ❌ **e é efeito EXTERNO** | **o dono** (push no celular) |
| **Envio ao cliente** | ❌ **nenhuma barreira** | **o cliente** |

Duas notas que mudam o desenho:

**O `Ticket` sobrevive por acidente, não por desenho.** O dedup compara assunto, e o cérebro não
é determinístico — a segunda execução pode produzir um assunto diferente o bastante para escapar.
Dedup por conteúdo é frágil por construção; a chave tem que ser o evento de origem.

**Os alarmes são efeitos externos, e portanto também ficam ambíguos.** Um push que saiu mas cuja
confirmação não voltou é indistinguível de um push que não saiu — o mesmo problema do envio ao
cliente, numa escala menor. Eles entram na mesma classificação, não na lista de "escritas locais".

## A descoberta central: o envio devolve um booleano

```ts
// Best-effort → boolean: nunca lança, false = não enviou.
export async function sendReply(ref: ChannelRef, to: string, text: string): Promise<boolean>
```

Nesse contrato, **"não enviei" e "não sei se enviei" são o mesmo valor**. Um `false` pode ser
"sem token" (seguro reenviar) ou "a requisição saiu, a Meta aceitou, e a resposta se perdeu na
volta" (proibido reenviar). O código reenvia nos dois casos.

Isso produz **dois** caminhos de duplicação que não precisam de crash nenhum:

1. **o retry de envio** — três tentativas, disparadas por qualquer `false`;
2. **o operador** — `operator-reply.server.ts` traduz `false` em "não foi enviada", o atendente
   lê isso, **clica de novo, e o cliente recebe duas vezes**.

O segundo é o mais insidioso: não há bug, não há log, e a pessoa que duplicou fez exatamente o
que a tela mandou.

Ambos os canais **devolvem um identificador** — o `wamid` da Meta, o `key.id` do Baileys — e o
código descarta os dois: só `response.ok` é lido. Identificador é o que ele é, e nada além:
**não prova aceitação remota nem entrega** (ver a tabela abaixo e §7b).

**Consequência para o plano:** `outbound_sending`/`outbound_sent` não têm como ser *decididos*
enquanto o envio devolver booleano. A máquina de estados não é o primeiro passo; o tipo de
retorno é.

---

# Os dois canais têm garantias diferentes

| | Baileys (QR — o canal padrão) | Meta (oficial) |
|---|---|---|
| Identificador devolvido | `key.id` — identificador da mensagem devolvido por uma chamada Baileys concluída. **Não prova aceitação remota nem entrega** | `wamid` — devolvido no corpo de uma resposta HTTP recebida. **Não prova entrega** |
| Reenvio seguro | ✅ **verificado** — ver T2 | ❌ nada equivalente |
| Ambíguo é resolvível? | **sim, com o mesmo id** | **não — só por olho humano** |

> ### ✅ Verificado em 2026-08-12 — `docs/spike-baileys-messageid.md`
>
> O Baileys respeita o `messageId` que passamos, e o WhatsApp **deduplica**: três envios com o
> mesmo id chegaram como **uma** mensagem — inclusive na fase com o **socket recriado**, que é o
> cenário do nosso problema (o processo cai, outro assume, tenta de novo).
>
> O controle negativo é o que dá valor ao resultado: três envios com ids **diferentes** chegaram
> como **três** mensagens. Sem ele, "uma bolha" também poderia significar "duas se perderam" — e
> isso não era hipotético: uma execução anterior teve três `key.id` devolvidos e **zero**
> entregas.
>
> **Escopo da observação:** `7.0.0-rc13`, WA Web `2.3000.104502…`, mensagem de texto,
> destinatário `@lid`, recriação **controlada** da conexão. É uma observação datada, não garantia
> permanente do servidor — se a versão mudar, refazer.

A metade Meta é irredutível de qualquer forma, e é ela que **justifica** a política fail-closed.

---

# A máquina proposta

```
received → user_persisted → brain_running → [decision_prepared] → effects_committed
         → outbound_sending → outbound_sent → done
```

| Estágio | Obrigatório? | Para quê | Crash aqui |
|---|---|---|---|
| `received` | sim | marco zero | ✅ do zero, seguro |
| `user_persisted` | sim | não regravar a fala | ✅ pula a gravação |
| **`brain_running`** | **sim — SEGURANÇA** | saber que o cérebro **pode** ter sido pago | ⛔ **ambíguo** |
| `decision_prepared` | **não — CONVENIÊNCIA** | retomar **sem** repetir o cérebro | ✅ retoma dos efeitos |
| `effects_committed` | sim | não repetir chamado/lead/handoff | ✅ retoma do envio |
| **`outbound_sending`** | **sim — SEGURANÇA** | saber que a mensagem **pode** ter saído | ⛔ **ambíguo** |
| `outbound_sent` | sim | só falta marcar | ✅ marca `done` |

**A distinção que a rev. 1 não fazia:** `brain_running` e `decision_prepared` resolvem problemas
diferentes e têm custos diferentes.

- `brain_running` é **uma coluna** e existe para **não pagar duas vezes**: sem ele, a retomada
  não sabe que o cérebro foi acionado, e o fail-closed não tem em que se apoiar. É barato e
  obrigatório.
- `decision_prepared` exige **persistir a decisão inteira** (reply, confidence, action,
  leadPatch, sources) — estrutura nova, não uma coluna. Ele não protege nada que
  `brain_running` já não proteja; ele apenas permite **retomar automaticamente** em vez de parar
  para reconciliação. É caro e **opcional**.

Sem `decision_prepared`, um crash em `brain_running` vira reconciliação humana. Com ele, viraria
retomada automática. Para um piloto de um a três clientes, a primeira opção é aceitável — e por
isso ele fica por último, com reavaliação explícita.

---

# Os dez pontos

**1. Estágios persistidos** — colunas `stage` e `stageAt` no `WebhookEvent`, mais ponteiros
(`tenantId`, `conversationId`, `userMessageId`, `assistantMessageId`). Hoje o evento não guarda
vínculo com nada que produziu, e um evento retomado é cego.

**2. Dados de cada etapa** — ver a distinção `brain_running` × `decision_prepared` acima.

**3. Transições por CAS** — a mecânica já existe testada em `AiSetupJob` (lease com token,
heartbeat, backoff, `failureKind` classificado). **Copiar, não inventar**: o repositório já tem
duas filas divergentes; uma terceira forma vira dívida no mesmo dia.

**4. Política por fronteira** — a tabela acima. Estágios antes de ação externa retomam; os dois
⛔ param, alarmam e vão para reconciliação humana.

**5. Órfãos em `processing`** — a faxina passa a ler o estágio antes de decidir. ⚠️ Enquanto o
estágio não existir, mudá-la para fail-closed transformaria **todo** crash precoce — onde
reprocessar é seguro **e desejável** — em mensagem parada esperando humano.

**6. `markDone`** — hoje falha em silêncio e o evento cai na faxina. Com `outbound_sent` gravado,
a retomada sabe que só falta marcar.

**7. Deduplicação de `Message`** — chave **composta**: `(sourceEventId, sourceEventKind)`, e não
`sourceEventId` único. O motivo é direto: **um mesmo `WebhookEvent` produz duas `Message`** — a
do cliente e a do assistente. Com unicidade simples, a segunda colidiria com a primeira e o
reprocessamento quebraria em vez de deduplicar.
⚠️ **A fala do cliente é gravada em três lugares** (caminho principal, ramo "humano já
conduzia", transação do billing) com garantias diferentes — um checkpoint só no principal deixa
dois buracos.

**7b. `sent` não significa "entregue"** — e também não significa "aceito do outro lado".
Significa apenas: **a chamada de envio terminou e devolveu um identificador de mensagem**. O
spike mostrou o limite disso na prática: três `key.id` devolvidos e **zero** entregas (endereço
errado). O identificador existe até para mensagem que vai para o vácuo. Confirmação de ENTREGA é
outra coisa, e nenhum canal dá isso hoje (decisão C).

**8. Ambíguo** — nunca repetido automaticamente. Vale para o envio ao cliente, para o cérebro e
**também para os alarmes**, que são efeitos externos.

**9. Migration** — medido: `stage String?` **nullable** vira `ALTER TABLE ADD COLUMN` puro,
enquanto `String @default("received")` faz o Prisma **derrubar e recriar** a tabela com seus três
índices. Além do custo, o `NULL` carrega informação: "linha escrita pelo código velho".
**Momento favorável:** a fila está vazia hoje — 12 eventos, todos `done`, nenhum em voo.

**10. Rollout e rollback** — §"Rollback semântico".

---

# Rollback semântico — o que o worker antigo faria

Medido: o cliente Prisma **velho** lê e escreve normalmente numa tabela com a coluna nova, e
`migrate deploy` não reclama de migration ausente da pasta. Estruturalmente o rollback funciona.

**Semanticamente, não.** O worker antigo não conhece `stage`. Se ele voltar a rodar com eventos
já marcados, ele:

- ignora o estágio e **reprocessa do zero** um evento que já respondeu o cliente;
- ignora `ambiguous` e **repete uma ação externa** que a política proíbe repetir;
- devolve para `pending` qualquer `processing` órfão, incluindo os que estavam parados
  **de propósito** aguardando reconciliação.

Ou seja: **o rollback do código é seguro apenas se nenhum evento estiver em estágio intermediário
ou ambíguo.** O procedimento de rollback precisa, nesta ordem:

1. verificar que não há evento com `stage` fora de `done`/`NULL`;
2. se houver, resolver (reconciliar ou marcar) **antes** de voltar o código;
3. só então reverter.

Sem esse passo, voltar o código transforma uma pausa deliberada em duplicação silenciosa.

---

# As três decisões

### A — ambíguo (**aprovada**)

Estado externo ambíguo **nunca** é repetido automaticamente: alarme e reconciliação humana. Vale
para envio, cérebro e alarmes.

Custo, dito com honestidade: hoje o retry **absorve** blips de rede e o cliente nem percebe. É
por isso que o passo 1 vem primeiro — com o resultado discriminado, "não enviei" continua
reenviando como hoje, e só o "não sei" vira trabalho humano.

### B — deploy (**revisada: sem deploy intermediário**)

**Um único release ao fim da 6C.8B.** A migration é aditiva e nullable, e roda pelo `release.sh`
— que **para o serviço, tira snapshot, migra e sobe o código novo**. A ordem é garantida pelo
próprio script: o schema novo existe antes de o código novo rodar.

Deploy intermediário fica descartado: não reduz o bloqueio comercial e cria uma janela em que
produção roda código sem os estágios.

### C — webhook de status da Meta (**adiada**)

Só depois do `providerMessageId` persistido — sem ele, o status que chegar não tem em que se
ancorar.

---

# Tarefas

> Cada tarefa: arquivos, o RED antes, o comando, e o checkpoint que a fecha.
> Nenhuma tarefa começa sem a anterior verde.

## T1 — `SendResult` discriminado e fim do retry sobre ambíguo ✅ **FEITO**

> Entregue. 17 provas, 5 mutações mortas, gate limpo (1420 testes). Dois achados registrados no
> código: (a) com o retorno virando objeto, `if (await sendReply(...))` fica **sempre
> verdadeiro** e o retry acharia que todo envio deu certo — o compilador não pega; (b) o
> primeiro teste do transporte usava `WHATSAPP_TOKEN` onde o código lê `WHATSAPP_ACCESS_TOKEN`,
> e o caso "sem token" **passava sem provar nada**. A mutação da presença cosmética só morreu
> depois de o RED 10 existir: um caminho sem prova própria não fica protegido por estar perto
> de outro que tem.

> ### Revisão independente — 2026-08-12
>
> **Comportamento: nenhum defeito.** Os dez desfechos (Meta, Baileys, fila, Central) estão
> classificados como o plano manda, e os dois únicos consumidores do envio leem `status` — não a
> verdade do objeto.
>
> **Prova: seis lacunas**, todas no mesmo formato — comportamento certo, sem teste que o
> defenda. Três no Baileys (`sem_comprovante`, socket lançando, teto por contato), duas no
> caminho até o operador (a `action` da Central e a cor do aviso na tela) e uma no alarme
> (nada garantia o silêncio no caminho feliz). A pior era o `catch` do Baileys: mutá-lo para
> `not_sent` retentável faz a fila reenviar sobre um socket que pode ter transmitido — a
> duplicação que o T1 inteiro existe para eliminar — e a suíte permanecia verde.
>
> É a mesma lição do RED 10, repetida: *um caminho sem prova própria não fica protegido por
> estar perto de outro que tem.* Fechadas no commit seguinte a este (7 provas novas, 6 mutações
> mortas). O `sendText` também anunciava `boolean` no próprio JSDoc.

**Sem migration.** É a única coisa que o passo 1 faz: **discriminar** e **parar de reenviar o
ambíguo**. Persistir o identificador fica para T4 — hoje não há coluna onde guardá-lo.

**Arquivos:** `app/lib/channels/types.ts`, `dispatch.server.ts`, `whatsapp.server.ts`,
`baileys.server.ts`, `whatsapp-queue.server.ts`, `operator-reply.server.ts`.

**Contrato (o implementado — este bloco estava obsoleto até 2026-08-12):**
```ts
type SendResult =
  | { status: 'sent'; providerMessageId: string }
  | { status: 'not_sent'; retryable: boolean; reason: string }
  | { status: 'ambiguous'; reason: string }
```

Duas exigências do tipo, e o motivo de cada uma:

- **`providerMessageId` é obrigatório em `sent`, nunca `string | null`.** Um envio "com
  sucesso" sem identificador não é confirmado — é exatamente o caso ambíguo, e deixá-lo entrar
  como `sent` com id nulo recriaria dentro do tipo a ambiguidade que ele existe para eliminar.
- **`not_sent` sem `retryable` não é aceito.** Sem esse campo, 429 (melhora esperando) e 401
  (não melhora nunca) voltam a ser o mesmo valor, e o retry perde o critério.

E o que `sent` significa, dito com a modéstia que ele tem: **a chamada de envio terminou e
devolveu um identificador**. Não é aceitação remota, não é entrega (§7b).

**REDs (todos falham hoje):**
1. timeout de rede no envio → resultado `ambiguous`, e `sendWithRetry` **não tenta de novo**;
2. HTTP 4xx → `not_sent`, e o retry acontece **como hoje**;
3. sucesso → `sent`, com o `providerMessageId` **presente no retorno** (ainda não persistido);
4. `operator-reply` com `ambiguous` → a tela **não** diz "não foi enviada"; diz que pode ter sido
   e pede conferência, **sem oferecer reenvio de um clique**;
5. `operator-reply` com `not_sent` → comportamento de hoje, inalterado.

**Comando:** `npx vitest run app/lib/channels/ app/lib/whatsapp-queue.test.ts app/lib/operator-reply*.test.ts`

**Checkpoint:** os cinco verdes; mutação "tratar `ambiguous` como `not_sent`" derruba os REDs 1 e
4; `npm test`, `typecheck`, `lint`, `build` limpos.

## T2 — spike do Baileys ✅ **FEITO** (hipótese confirmada)

**Não é código de produção.** Enviar duas vezes com o mesmo `messageId` para um número de teste e
observar o aparelho.

**Checkpoint:** resultado escrito neste documento. Se a hipótese cair, T3 é removida e o Baileys
passa a ter a mesma garantia da Meta.

## T3 — dividida em T3a → T4 → T3b (2026-08-12)

O T3 original misturava duas coisas de custo e risco muito diferentes: **passar um id adiante**
(sem schema, sem migration) e **repetir um envio ambíguo** (que só faz sentido com o id
persistido, ou seja, depois da migration). Juntas, elas não podiam ser autorizadas
separadamente. Separadas, cada uma tem o seu próprio portão.

E o RED antigo era **impossível de automatizar**: "dois envios com o mesmo id → o aparelho
mostra **uma** mensagem" depende de um celular e de um olho humano. Isso é caracterização
manual, e já foi feito **uma vez** no T2. Não vira teste de suíte, e um checkpoint que a suíte
não consegue verificar não protege nada no dia seguinte.

> **Onde mora a prova de deduplicação externa:** exclusivamente no T2
> (`docs/spike-baileys-messageid.md`), como observação manual e datada. Nenhuma tarefa abaixo
> tenta reproduzi-la em teste automatizado.

### T3a — plumbing do id, sem schema ✅ **FEITO e APROVADO (2026-08-12)**

> Commits `f01c983` (plumbing) e `403a095` (corretivo P1: exige identidade devolvida). Revisão
> independente aprovada — a lacuna do primeiro commit era o adapter provar que o id SAI e aceitar
> qualquer `key.id` de volta; o corretivo fechou. Encerrado.

O caminho interno passa a poder **fornecer** o `outboundMessageId`, e o adapter Baileys
encaminha **exatamente esse id** ao provedor.

- o adapter repassa o id como `MiscMessageGenerationOptions.messageId`;
- **não** ativa retry durável;
- **não** altera schema, **não** cria migration.

**Âncora = `WebhookEvent.id`**, não o `messageId`. É a chave de linha que o T5 já vai usar como
`sourceEventId`, e duas âncoras diferentes para o mesmo evento viram dívida no dia seguinte. É
reversível enquanto nada for persistido — que é exatamente o estado do T3a.

**A chave inclui um propósito**: `(eventId, purpose)`, com `purpose = 'reply' | 'media_courtesy'`.
Hoje os dois envios de um evento são mutuamente exclusivos (a cortesia de mídia dá `return` antes
do motor), então um id por evento bastaria; o discriminante existe para o dia em que deixarem de
ser — mesmo desenho do `(sourceEventId, sourceEventKind)` do ponto 7.

> **O formato é herdado da medição, não escolhido.** O T2 validou ids no formato da biblioteca —
> o spike usou `generateMessageID()` do próprio Baileys tanto no experimento quanto no controle
> negativo, e um id de formato arbitrário **nunca** foi testado contra o provedor. A derivação
> preserva esse formato de propósito: `'3EB0' + 36 hex MAIÚSCULOS`
> (`node_modules/@whiskeysockets/baileys/lib/Utils/generics.js:150`). Sair dele é abandonar a
> única evidência que temos, e o erro só apareceria em produção.

**REDs (automatizáveis, e é esse o ponto):**
1. todas as tentativas do **mesmo** outbound recebem **exatamente o mesmo** `outboundMessageId`;
2. o adapter Baileys encaminha esse id como `MiscMessageGenerationOptions.messageId` — provado
   no argumento recebido pelo `sendMessage`, não no retorno;
3. uma tentativa de **outro** outbound recebe **outro** id;
4. mesmo evento com propósito diferente (`reply` × `media_courtesy`) → ids diferentes;
5. determinismo entre execuções, contra um valor **fixo** escrito no teste (golden) — trocar o
   algoritmo depois do T3b em produção quebraria a idempotência em silêncio, e o golden obriga a
   decisão a ser consciente;
6. o id casa com `/^3EB0[0-9A-F]{36}$/`, o único formato que o T2 observou;
7. **sem** id fornecido, o envio segue como hoje e a biblioteca escolhe — o T3a não pode tornar o
   parâmetro obrigatório (o operator-reply é ação do operador e não tem evento de origem);
8. o identificador **devolvido** tem que ser o solicitado: `key.id` divergente é
   `ambiguous / identificador_divergente`, nunca `sent` (lacuna P1 achada na revisão do T3a —
   encaminhar o id não bastava, o adapter aceitava qualquer id de volta, e o T3b passaria a reusar
   um identificador que não é o da mensagem que existe do outro lado). `ambiguous` e não
   `not_sent` porque o socket já foi chamado; e o id solicitado **não** vira `providerMessageId`,
   para a divergência não ficar maquiada.

O terceiro é o que dá valor aos dois primeiros: sem ele, "id sempre igual" também seria
satisfeito por uma constante — e uma constante colaria mensagens diferentes numa só.

**O canal Meta ignora o id.** A Meta gera o `wamid` dela e não há campo para propor um: o
parâmetro atravessa `sendReply` e não é usado no ramo `meta`.

Onde ficou: `app/lib/channels/outbound-id.server.ts` (função pura), `types.ts` (`SendOptions`),
`dispatch.server.ts`, `baileys.server.ts`, `whatsapp-queue.server.ts`.

### T4 — migration e checkpoints ⛔ **exige autorização específica antes de começar**

- migration **aditiva e nullable**;
- `stage`, `stageAt`, `providerMessageId` e os ponteiros necessários;
- `brain_running` e `outbound_sending` **obrigatórios**;
- recuperação de órfãos lendo o estágio;
- rollback semântico (§"Rollback semântico").

Detalhes e REDs: continuam abaixo, na seção que era "T4".

### T3b — retry durável do Baileys

**Depois do T4**, nunca antes: ele reutiliza o id **persistido** (ou derivado de forma estável),
e sem a coluna não há o que reutilizar.

- somente o **Baileys** pode repetir um resultado `ambiguous`, e **com o mesmo id**;
- a **Meta continua fail-closed** em `ambiguous` — lá não há nada equivalente.

## T4 (detalhe) — migration aditiva + estágios

**Primeira migration.** `stage String?`, `stageAt DateTime?`, `providerMessageId String?`,
ponteiros. Nullable por medição (§9).

**REDs:** crash simulado em cada fronteira → o estágio gravado corresponde; faxina lê o estágio e
**não** devolve `ambiguous` para `pending`; evento legado (`stage NULL`) é tratado como legado e
nunca como "recebido e parado".

**Checkpoint:** migration ensaiada em **cópia** antes; `migrate diff` confirma `ALTER TABLE ADD
COLUMN` sem recriação de tabela; procedimento de rollback semântico documentado e testado.

## T5 — `(sourceEventId, sourceEventKind)` nos três pontos

**REDs:** reprocessar o mesmo evento → **uma** `Message` de cliente e **uma** de assistente; e o
mesmo para cada um dos três pontos de gravação, separadamente (a lição da 6C: um teste que
atravessa um caminho não diz nada sobre os outros).

## T6 — efeitos e alarmes ancorados no evento

**REDs:** reprocessar → um `HandoffEvent`, um `Ticket`, **um** push de alarme.

## T7 — `decision_prepared` (**opcional — reavaliar aqui**)

Só se, ao chegar neste ponto, a reconciliação manual de `brain_running` estiver se mostrando
frequente. Custo alto, benefício de conveniência.

---

# Riscos

| Risco | Por quê |
|---|---|
| 🔴 Escritas no caminho quente | 8 estágios onde hoje há 2 escritas, no mesmo lock serializado do SQLite que motivou a 6C. Medir antes de fixar a granularidade |
| 🔴 Faxina fail-closed cedo demais | Sem o estágio gravado, todo crash precoce vira mensagem parada esperando humano |
| 🔴 Rollback com evento em voo | O worker antigo reprocessa `staged` e repete `ambiguous`. Exige o procedimento acima |
| 🟠 `attempts` com dois sentidos | Hoje é "quantas vezes começamos do zero". Com retomada, uma retomada barata gastaria a mesma cota que um reprocesso inteiro |
| 🟠 Replay não é limpo | O histórico é lido antes de persistir: a segunda execução **vê a primeira**, então o contexto do cérebro difere |
| 🟠 `SendResult` atravessa 5 arquivos | E o contrato "nunca lança" está gravado em teste |
| 🟡 Backfill é território novo | Nenhuma das 18 migrations do repo jamais executou `UPDATE` |
