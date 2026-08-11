# Spike — o Baileys respeita um `messageId` que a gente escolhe?

> **T2 do plano da 6C.8B.** Experimento, não implementação. Envia mensagem **real**.
> Rev. 2 — dez bloqueios corrigidos sobre a rev. 1. Execução ainda **não autorizada**.

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

Roteiro pronto. Aguardando sua autorização para rodar.

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

# Forma B — bloqueada

Usar a sessão do `adv-gac` **não é mais uma opção com ressalva: o script recusa**. Dois motivos:

1. abrir uma segunda conexão com as credenciais dela pode derrubar o atendimento;
2. no fim, o estado `desconectado` **não é retomado no boot** — o cliente ficaria mudo até alguém
   parear de novo, e a descoberta viria pelo cliente reclamando.

Se um dia for inevitável, isso vira uma tarefa própria, com janela combinada e plano de volta.

---

# Resultado

> Preencher depois de rodar.

| | |
|---|---|
| Data | |
| Empresa / sessão | |
| Versão do Baileys | `7.0.0-rc13` |
| `key.id` — 1º envio (fase 1) | |
| `key.id` — 2º envio (fase 1) | |
| `key.id` — 3º envio (fase 2, socket recriado) | |
| **Bolhas no aparelho** | |
| **Veredito** | |

### Se a FASE 2 também deduplicou (1 bolha)

**T3 entra no plano.** O `sendText` passa a aceitar um id derivado do `WebhookEvent.messageId`, e
o canal QR ganha reenvio seguro.

Com uma ressalva que vai junto no plano: **isto foi observado na versão `7.0.0-rc13`, para
mensagem de texto, com recriação controlada da conexão.** Não é garantia permanente do servidor
do WhatsApp — é uma observação datada, e a caracterização de versão vale como para o driver do
banco (`driver-sincrono.test.ts`).

### Se só a FASE 1 deduplicou (2 bolhas)

A dedução é **da instância**, não do servidor — e não sobrevive ao restart, que é exatamente o
nosso caso. **T3 sai do plano** do mesmo jeito.

### Se não deduplicou (3 bolhas)

**T3 sai.** E o plano principal muda em dois pontos:

1. a tabela "os dois canais têm garantias diferentes" passa a dizer que **nenhum** canal tem
   reenvio seguro;
2. a política fail-closed deixa de ser "por causa da Meta" e passa a valer para o produto
   inteiro — o que **aumenta** o peso da reconciliação humana e vira argumento para reavaliar o
   `decision_prepared` (T7), hoje marcado como opcional.

Não existe desfecho ruim aqui. Existe desfecho que muda o plano — e é para isso que o spike
serve.
