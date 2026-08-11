# 6C.8B — idempotência durável do WebhookEvent

> Plano, não implementação. Nenhuma migration foi criada. Levantado em 2026-08-11 sobre o
> `HEAD 4a943da`, com quatro frentes de leitura do código e três medições no banco.

---

## 1. O que está acontecendo

Quando um cliente manda mensagem no WhatsApp, o Hermes grava o evento, roda o motor e responde.
Se o processo morrer no meio disso — queda de energia, `systemctl restart`, o Pi travando — o
evento volta para a fila e **o trabalho inteiro é refeito do zero**.

## 2. Problema e impacto

O sistema não guarda onde parou. Refazer do zero significa, na prática:

- o cliente **aparece falando duas vezes** na tela do atendente;
- o cérebro é **pago de novo** (dezenas de segundos e dinheiro, pela mesma pergunta);
- o chamado pode duplicar;
- **o cliente pode receber a mesma resposta duas vezes**.

E há um caminho pior, que o próprio código já reconhece: quando o Hermes responde o cliente mas
falha ao marcar o evento como concluído, ele **loga "CRÍTICO" e segue**. Dez minutos depois, uma
faxina devolve o evento para a fila — e tudo acima acontece com o cliente **já respondido**.

## 3. Gabriel precisa decidir?

**Sim — três coisas**, isoladas na §9. Nenhuma delas é técnica.

## 4. Recomendação

Antes de qualquer máquina de estados: **parar de jogar fora o comprovante de envio**. É o passo
que destrava todos os outros, e a §6 explica por quê.

## 5. Estado da etapa

Plano escrito. **Migration não criada, código não alterado.** Aguardando as três decisões.

---

# O diagnóstico

## O que a fila protege hoje, e o que não protege

Ela protege bem a **chegada**: o evento é gravado antes do `200`, e o reenvio da Meta não
duplica (`messageId` é `@unique`). O claim é atômico e usa compare-and-swap.

O que ela não protege é tudo o que vem depois. O único marcador de progresso é `status`, com
quatro valores — `pending`, `processing`, `done`, `failed`. Entre "peguei" e "terminei" cabe o
fluxo inteiro, e **nada disso deixa rastro no evento**: ele não guarda nem o id da conversa que
criou.

A faxina de órfãos, que é o **único** caminho de saída de `processing`, decide olhando um único
dado: a idade do `claimedAt`. Ela não sabe distinguir "morreu antes de fazer qualquer coisa" de
"morreu depois de responder o cliente" — e por isso trata as duas do mesmo jeito.

## O inventário do que duplica

| O que | Idempotente hoje? | Quem vê a duplicata |
|---|---|---|
| Conversa | ✅ chave única | — |
| `Lead` | ✅ `upsert` por conversa | — |
| `Ticket` | ⚠️ dedup **heurístico** por similaridade de assunto | operador |
| `Message` do cliente | ❌ | **operador** — a pessoa falando duas vezes |
| `Message` do assistente | ❌ | operador |
| `HandoffEvent` | ❌ | operador — conversa devolvida volta para a fila |
| `MessageTrace` | ❌ | o número que mede o produto |
| Alarme sensível | ❌ | **o dono** — dois pushes de emergência pelo mesmo caso |
| **Envio ao cliente** | ❌ **nenhuma barreira** | **o cliente** |

O `Ticket` merece nota: ele sobrevive a um reprocessamento **por acidente**, não por desenho — o
dedup compara assunto, e o cérebro não é determinístico, então a segunda execução pode produzir
um assunto diferente o bastante para escapar. Dedup por conteúdo é frágil por construção; a
chave tem que ser o evento de origem.

## 6. A descoberta que reordena o plano

**O envio devolve um booleano, e isso é o gargalo de tudo.**

```ts
// Best-effort → boolean: nunca lança, false = não enviou.
export async function sendReply(ref: ChannelRef, to: string, text: string): Promise<boolean>
```

Nesse contrato, **"não enviei" e "não sei se enviei" são o mesmo valor**. Um `false` pode ser
"sem token" (seguro reenviar) ou "a requisição saiu, a Meta aceitou, e a resposta se perdeu na
volta" (proibido reenviar). O código trata os dois como iguais e reenvia — é assim que o cliente
recebe a mensagem duas vezes hoje, **sem crash nenhum**, só com um blip de rede.

Pior: os dois canais **devolvem comprovante** e o código descarta os dois. A Meta devolve o
`wamid` no corpo da resposta; o Baileys devolve o objeto da mensagem com o `key.id`. Hoje só
`response.ok` é lido.

Isso reordena o plano que você esboçou: **`outbound_sending`/`outbound_sent` não têm como ser
decididos enquanto o envio devolver booleano.** A máquina de estados não é o primeiro passo — o
tipo de retorno é.

## 7. Os dois canais têm garantias diferentes

Achado que muda o desenho: **o Baileys aceita `messageId` customizado** no envio. Isso é uma
chave de idempotência de verdade — dá para reenviar com o mesmo id e o WhatsApp trata como a
mesma mensagem.

A Meta **não oferece nada equivalente**: nem cabeçalho de idempotência, nem endpoint para
consultar se uma mensagem foi enviada. Se a chamada falhar por timeout, não existe `wamid`, e
nem o webhook de status ajuda — não há id para casar.

| | Baileys (QR — o canal padrão) | Meta (oficial) |
|---|---|---|
| Reenvio seguro | ✅ com `messageId` próprio | ❌ impossível |
| Descobrir depois | `key.id` devolvido | `wamid` devolvido, mas só se a resposta chegou |
| Ambíguo é resolvível? | **sim** | **não — só por olho humano** |

O canal padrão do produto é justamente o que dá para proteger de verdade. E é a existência do
caso Meta que **justifica** a política fail-closed: ali a ambiguidade é irredutível.

---

# A máquina proposta

```
received → user_persisted → brain_running → decision_prepared
         → effects_committed → outbound_sending → outbound_sent → done
```

O que separa os estágios não é a etapa do código, é **a fronteira do que pode ser refeito**:

| Estágio | Crash aqui | Retomada |
|---|---|---|
| `received` | nada aconteceu | ✅ do zero, seguro |
| `user_persisted` | a fala do cliente já está gravada | ✅ pula a gravação |
| `brain_running` | **o cérebro pode ter sido pago** | ⛔ **ambíguo** |
| `decision_prepared` | decisão persistida, efeitos não | ✅ retoma dos efeitos |
| `effects_committed` | chamado/lead/handoff gravados | ✅ retoma do envio |
| `outbound_sending` | **a mensagem pode ter saído** | ⛔ **ambíguo** (Meta) / ✅ (Baileys) |
| `outbound_sent` | cliente recebeu, falta marcar | ✅ só marca `done` |

Os dois ⛔ são as janelas que banco local não fecha. Tudo o mais é retomável.

---

# 8. Os dez pontos

**1. Estágios persistidos** — no próprio `WebhookEvent`, colunas `stage` e `stageAt`, mais
ponteiros (`tenantId`, `conversationId`, `userMessageId`, `assistantMessageId`). Hoje o evento
não guarda vínculo com nada que produziu, e por isso um evento retomado é cego.

**2. Dados de cada etapa** — `decision_prepared` **não tem onde morar**: nada da decisão do
cérebro é persistido hoje. Persistir a decisão é estrutura nova, não uma coluna de estágio. É o
item mais caro do plano e o candidato número um a ficar para depois.

**3. Transições por CAS** — a mecânica já existe testada em `AiSetupJob` (lease com token,
heartbeat, backoff, `failureKind` classificado). **Copiar, não inventar**: o repositório já tem
duas filas divergentes, e uma terceira forma vira dívida no mesmo dia.

**4. Política por fronteira** — a tabela acima. Estágios antes de chamada externa retomam;
estágios ambíguos param.

**5. Órfãos em `processing`** — a faxina passa a ler o estágio antes de decidir. ⚠️ Enquanto o
estágio não existir, mudá-la para fail-closed transformaria **todo** crash precoce (onde
reprocessar é seguro **e desejável**) em mensagem parada esperando humano.

**6. `markDone`** — hoje falha em silêncio e o evento cai na faxina. Com `outbound_sent`
gravado, a retomada sabe que só falta marcar, e não refaz nada.

**7. Deduplicação** — a chave natural é o `WebhookEvent.messageId` (já `@unique`), não o
conteúdo. Uma coluna `sourceEventId` em `Message` resolve cliente e assistente com o mesmo
mecanismo. ⚠️ **A fala do cliente é gravada em três lugares diferentes** (caminho principal,
ramo "humano já conduzia", transação do billing) com garantias distintas — um checkpoint só no
principal deixa dois buracos.

**8. Cérebro e envio ambíguos** — §9, decisão A.

**9. Migration** — medido: `stage String?` **nullable** vira `ALTER TABLE ADD COLUMN` puro,
enquanto `String @default("received")` faz o Prisma **derrubar e recriar** a tabela com seus três
índices. Além do custo, o `NULL` carrega informação: significa "linha escrita pelo código
velho", que é exatamente o que um rollback precisa saber. **Momento favorável:** a fila está
vazia hoje — 12 eventos, todos `done`, nenhum em voo.

**10. Rollout e rollback** — medido: o cliente Prisma velho lê e escreve normalmente na tabela
com a coluna nova, e `migrate deploy` não reclama de migration ausente da pasta. O rollback é
possível; o preço é semântico, não estrutural.

---

# 9. As três decisões

### A — o que fazer com o ambíguo

**A recomendação que você já deu, e eu concordo:** não repetir automaticamente. Alarme e
reconciliação humana.

O custo, dito com honestidade: hoje o `sendWithRetry` **absorve** blips de rede comuns com
sucesso na segunda tentativa, e o cliente nem percebe. Fail-closed sobre todo ambíguo
transformaria parte desses blips em alarme e trabalho manual. É por isso que a §6 vem primeiro:
com o retorno discriminado, "não enviei" (reenvia, como hoje) fica separado de "não sei"
(alarma) — e só o segundo vira trabalho humano.

Para um piloto de um a três clientes assistidos, o custo de uma reconciliação ocasional é muito
menor que o de o cliente receber a mesma resposta duas vezes.

### B — a ordem do deploy

Produção está **13 commits atrás**. Recomendo separar:

1. os 13 commits **sozinhos**, sem migration, confirmar o serviço no ar;
2. a migration **sozinha**, depois.

Misturar transforma duas fontes de falha independentes num diagnóstico só — e o caminho de erro
do `release.sh` reverte o **código** deixando o **schema** à frente, que é o cenário mais difícil
de desfazer.

### C — o webhook de status da Meta (pode ficar para depois)

Ligar a confirmação de entrega exige ação sua no painel da Meta e reverter um comportamento hoje
protegido por teste. Só faz sentido **depois** de guardar o `wamid` — sem ele, o status que
chegar não tem em que se ancorar.

---

# 10. Ordem de execução proposta

| # | Passo | Depende de |
|---|---|---|
| 1 | Envio devolve resultado discriminado (`enviado`+id / `nao_enviado` / `ambiguo`) | nada |
| 2 | Persistir o comprovante de envio (`wamid` / `key.id`) | 1 |
| 3 | `messageId` próprio no Baileys → reenvio seguro no canal padrão | 2 |
| 4 | Coluna `stage` nullable + ponteiros; faxina lê o estágio | decisão B |
| 5 | `sourceEventId` em `Message` nos **três** pontos de gravação | 4 |
| 6 | Efeitos e alarme ancorados no evento de origem | 5 |
| 7 | `decision_prepared` (o caro) | 6 — reavaliar se ainda vale |

Os passos 1–3 já reduzem o defeito mais visível (**cliente recebendo duas vezes**) sem tocar no
schema do `WebhookEvent` e sem migration.

---

# 11. Riscos

| Risco | Por quê |
|---|---|
| 🔴 Escritas no caminho quente | 8 estágios onde hoje há 2 escritas, no mesmo lock serializado do SQLite que motivou a 6C inteira. Medir antes de fixar a granularidade |
| 🔴 Faxina fail-closed cedo demais | Sem o estágio gravado, todo crash precoce vira mensagem parada esperando humano |
| 🟠 `attempts` com dois sentidos | Hoje significa "quantas vezes começamos do zero". Com retomada, uma retomada barata gastaria a mesma cota que um reprocesso inteiro |
| 🟠 Replay não é limpo | O histórico é lido antes de persistir: a segunda execução **vê a primeira**, então o contexto do cérebro difere |
| 🟠 O tipo de retorno atravessa 5 arquivos | `dispatch`, `whatsapp`, `baileys`, `whatsapp-queue`, `operator-reply` — e o contrato "nunca lança" está gravado em teste |
| 🟡 Backfill é território novo | Nenhuma das 18 migrations do repo jamais executou `UPDATE` |
