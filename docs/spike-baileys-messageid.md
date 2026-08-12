# Spike — o Baileys respeita um `messageId` que a gente escolhe?

> **T2 do plano da 6C.8B.** ✅ **EXECUTADO em 2026-08-12 — hipótese CONFIRMADA.**
> Ver "Resultado", no fim. O roteiro fica registrado para quem precisar repetir a observação
> quando a versão do Baileys ou do WA Web mudar.

---

## 1. O que está acontecendo

O plano supõe que, no canal do QR, dá para reenviar uma mensagem com o **mesmo identificador** e
o WhatsApp entender que é a mesma — sem entregar duas.

## 2. Problema e impacto

**É hipótese, não fato.** Eu li que a opção existe nos tipos da biblioteca, e a versão instalada
é uma `release candidate` (`7.0.0-rc13`). Ler que uma opção existe não é ver o aparelho receber
uma bolha só.

Se cair, o canal do QR — padrão do produto — herda a limitação do canal oficial: envio em dúvida
**nunca** pode ser repetido automaticamente, e sobra reconciliação humana.

## 3. Gabriel precisa decidir?

Sim: **autorizar o envio real**, e confirmar que você tem os dois números.

## 4. Recomendação

Forma A, com sessão dedicada. A forma B (usar a sessão que atende cliente) está **bloqueada no
próprio script** — ver §"O que mudou".

## 5. Estado

✅ Executado. Quatro tentativas até acertar o procedimento — as três primeiras falharam por
defeitos MEUS, não do experimento: serviço "parado" cuja flag mudou antes do processo morrer;
versão do WA Web omitida (o produto busca, o spike não buscava → `405`); e envio para os dígitos
reconstruídos em vez do `@lid`, que mandou as três mensagens para o vácuo.

---

# O que mudou nesta revisão

A rev. 1 tinha dez problemas. Os que mudam o que você faz:

**A trava não travava nada.** Ela só consultava o tenant quando a confirmação estava *ausente* —
com `=sim`, aceitava qualquer sessão, inclusive a do cliente. A variável removia o aviso, não o
risco. Agora a validação é **sempre**, e `adv-gac` está numa lista de bloqueio que não tem como
contornar por variável de ambiente.

**O script apontava para o banco errado.** Sem o `.env` do serviço carregado, ele cairia no
`dev.db` do checkout por fallback — não acharia a sessão, ou tentaria decifrar o auth com a chave
errada. Agora ele **recusa começar** sem `DATABASE_URL`, sem chave de cifra e sem
`BAILEYS_ENABLED=1`.

**Um teste só não respondia a pergunta.** Repetir o id no mesmo socket pode deduplicar por cache
da instância — o que não sobrevive a um restart, que é justamente o nosso caso. Agora são **duas
fases**, e a segunda recria a conexão do zero.

**O `disconnect` do produto gravaria `desconectado`** — estado que o boot do serviço não retoma
sozinho. O script usa `end()`, que derruba o socket sem tocar no banco.

**Sem `try/finally` nem tratamento de Ctrl+C**, uma falha no meio deixaria socket aberto, banco
conectado e o serviço parado esperando você perceber.

E o script deixou de precisar de qualquer alteração em `baileys.server.ts`: ele monta o próprio
socket a partir do auth salvo. **Nenhuma porta de teste entra no código de produção.**

---

# Antes de começar

Você precisa de:

- [ ] um **número de WhatsApp dedicado ao teste** (não o que atende cliente);
- [ ] um **segundo número** para receber (pode ser o seu pessoal);
- [ ] uma **janela de alguns minutos** com o Hermes fora do ar.

> Mesmo com número dedicado, o serviço precisa parar: duas conexões brigam pelo mesmo processo.
> Isso tira o `adv-gac` do ar durante o teste. É indisponibilidade real, curta e planejada.

## Passo 0 — a fila está vazia?

Não vale parar o serviço com mensagem de cliente esperando:

```bash
sqlite3 /home/pi/projects/produto-hermes/dev.db "SELECT status, COUNT(*) FROM WebhookEvent WHERE status IN ('pending','processing') GROUP BY status;"
```

Esperado: **nenhuma linha**. Se aparecer algo, espere a fila esvaziar.

---

# Forma A — a única liberada

## Passo 1 — criar a sessão de teste

No Hermes, em **Canais**, crie uma conexão nova e pareie com o número **de teste**.

Depois pegue o id e o slug da empresa:

```bash
sqlite3 -header /home/pi/projects/produto-hermes/dev.db "SELECT cs.id, t.slug, cs.status FROM ChannelSession cs JOIN Tenant t ON t.id = cs.tenantId WHERE cs.status = 'conectado';"
```

## Passo 2 — rodar (o serviço para e volta sozinho)

Este bloco **religa o Hermes mesmo se o spike falhar ou você apertar Ctrl+C** — é o `trap`.
Troque os quatro valores da primeira linha:

```bash
cd /home/pi/projects/produto-hermes && export SPIKE_SESSION_ID=<ID_DA_SESSAO> SPIKE_TENANT=<SLUG_DA_EMPRESA> SPIKE_TO=<NUMERO_QUE_RECEBE> SPIKE_TO_CONFIRMA=<NUMERO_QUE_RECEBE> && trap 'systemctl --user start hermes' EXIT INT TERM && systemctl --user stop hermes && sleep 2 && set -a && . /home/pi/hermes-deploy/shared/.env && set +a && timeout 300 npx --yes tsx@4.23.12 scripts/spike-baileys-messageid.ts
```

O que cada pedaço faz:

| | |
|---|---|
| `trap ... EXIT INT TERM` | religa o serviço aconteça o que acontecer |
| `set -a && . .env` | carrega o ambiente do serviço (banco, chave de cifra, `BAILEYS_ENABLED`) |
| `timeout 300` | teto de 5 minutos — não fica pendurado |
| `npx --yes tsx@4.23.12` | versão fixa. **Baixa uma ferramenta** se não estiver em cache (hoje está) |

## Passo 3 — olhar o aparelho

**Esta é a parte que decide.** O terminal diz se a biblioteca respeitou o id; só o celular diz se
o WhatsApp deduplicou.

Conte as mensagens de teste no número que recebeu:

- **1 bolha** → deduplicou nas duas fases. **Hipótese confirmada.**
- **2 bolhas** → deduplicou em uma fase só. **Anote qual** — muda a conclusão.
- **3 bolhas** → não deduplica. **Hipótese cai.**

## Passo 4 — conferir que tudo voltou

```bash
systemctl --user is-active hermes && curl -sk -o /dev/null -w "health:%{http_code}\n" https://localhost:5173/health && sqlite3 -header /home/pi/projects/produto-hermes/dev.db "SELECT t.slug, cs.status FROM ChannelSession cs JOIN Tenant t ON t.id = cs.tenantId WHERE cs.status != 'desconectado';"
```

Esperado: `active`, `health:200`, e **`adv-gac` como `conectado`**.

> Se o `adv-gac` não voltar, me chame antes de mexer — o caminho de recuperação depende do
> motivo, e parear de novo sem necessidade custa uma leitura de QR no celular do cliente.

---

# Sobre a sessão usada

A execução acabou usando a sessão do `adv-gac` — que o dono esclareceu ser o **tenant pessoal de
teste dele**, com o WhatsApp reserva pareado, e não cliente pagante. A evidência bate: assinatura
`provider: none` em trial vencido, zero documentos de base, e as conversas existentes são os
próprios testes.

A lista de bloqueio por empresa virou **confirmação nominal**: `SPIKE_ACEITO_RISCO_TENANT` tem
que nomear a empresa da sessão e `SPIKE_EXPECTED_SESSION_ID` tem que bater com o id — errar de
sessão exige errar duas vezes. Um `=sim` genérico continua recusado.

O pareamento sobreviveu às quatro execuções: o script usa `end()` no socket, nunca o
`disconnect()` do produto, que gravaria `desconectado` — estado que o boot não retoma sozinho.

---

# Resultado

**Executado em 2026-08-12. Hipótese CONFIRMADA — com o controle negativo que a valida.**

| | |
|---|---|
| Sessão / empresa | `cmsdoyvpg…ekun` / `adv-gac` (tenant pessoal de teste do dono) |
| Emissor | WhatsApp reserva pareado na sessão |
| Destino | `@lid` do inbound autorizado — **não** os dígitos reconstruídos |
| Baileys | `7.0.0-rc13` |
| WA Web | `2.3000.1045021694` (experimento) · `2.3000.1045028006` (controle) |
| Tipo | mensagem de texto |

### Experimento — mesmo `messageId` nas três chamadas

| | |
|---|---|
| Fase 1 (mesmo socket), 1º envio | `key.id` = id pedido ✅ |
| Fase 1, 2º envio (≈3 s depois) | `key.id` = id pedido ✅ |
| Fase 2 (**socket recriado**), 3º envio | `key.id` = id pedido ✅ |
| **Bolhas no aparelho** | **1** |

### Controle negativo — três `messageId` DIFERENTES

| | |
|---|---|
| Três envios, mesma sequência e intervalos | três `key.id` distintos ✅ |
| **Bolhas no aparelho** | **3** |

### Por que o controle era indispensável

Sozinho, "três envios → uma bolha" tem duas leituras opostas: o WhatsApp deduplicou, **ou** só
uma das três chegou. E a segunda não é hipotética — uma execução anterior deste mesmo spike teve
os **três `key.id` devolvidos e ZERO entregas** (endereço errado, ver abaixo).

O controle separa as duas: com ids diferentes chegaram **três**. Logo a entrega é confiável, e a
bolha única do experimento foi **deduplicação**, não perda.

### Conclusão, com o escopo que ela tem

O WhatsApp deduplica pelo `messageId` escolhido pelo cliente, **e a deduplicação sobreviveu à
recriação da conexão** — que é o cenário do nosso problema: o processo cai, outro assume, e
tenta de novo.

**Isto é uma observação datada, não uma garantia do servidor.** Vale para: `7.0.0-rc13`, WA Web
`2.3000.104502…`, mensagem de texto, destinatário `@lid`, um remetente, recriação **controlada**
da conexão (não um crash real), intervalos de segundos. Se qualquer um desses mudar, a
observação precisa ser refeita — a mesma disciplina de `driver-sincrono.test.ts`.

### O que isso libera

**T3 entra no plano.** No canal do QR — que é o padrão do produto — um envio ambíguo pode ser
repetido com o mesmo id derivado do `WebhookEvent.messageId`, sem entregar duas vezes ao
cliente. O fail-closed continua valendo para a Meta, onde a ambiguidade é irredutível.

---

## Dois achados que vieram de graça

### 1. Comprovante do provedor NÃO é prova de entrega

Na execução com endereço errado: **três `key.id` devolvidos, zero mensagens entregues**.

O `SendResult` do T1 trata `sent` + `providerMessageId` como sucesso. É verdade que o provedor
aceitou e deu recibo — e **falso** que o cliente recebeu. O recibo existe até para mensagem que
vai para o vácuo. Isso não invalida o T1 (a distinção `not_sent`/`ambiguous`/`sent` continua
necessária), mas o significado de `sent` precisa ser mais modesto no plano, e reforça a decisão
C: confirmação de entrega é outra coisa, e nenhum canal dá isso hoje.

### 2. `@lid`: o `contactId` do canal QR não é telefone — **hipótese, investigar à parte**

Os inbounds recentes da sessão chegam como `@lid` (número oculto), e o `contactId` derivado tem
14–15 dígitos — não é um telefone e não dá para converter. No histórico dá para ver a virada: em
12/07 vinham como `@s.whatsapp.net`; de 03/08 em diante, todos `@lid`.

**Não está concluído que o Hermes seja incapaz de conhecer o telefone.** Antes de afirmar isso é
preciso verificar: (a) o Baileys oferece mapeamento oficial LID ↔ número? (b) o auth state guarda
esse vínculo? (c) ele sobrevive a restart? Investigação separada, fora da 6C.8B.






