# Spike — o Baileys respeita um `messageId` que a gente escolhe?

> **T2 do plano da 6C.8B.** Experimento, não implementação.
> Roteiro para o Gabriel rodar. Envia mensagem **real**.

---

## 1. O que está acontecendo

O plano supõe que, no canal do QR, dá para reenviar uma mensagem com o **mesmo identificador** e
o WhatsApp entender que é a mesma — sem entregar duas.

## 2. Problema e impacto

**Isso é hipótese, não fato.** Eu li nos tipos da biblioteca que a opção existe, e a versão
instalada é uma `release candidate` (`7.0.0-rc13`). Ler que uma opção existe não é a mesma coisa
que ver o aparelho receber uma bolha só.

Se a hipótese **cair**, o canal do QR — que é o padrão do produto — passa a ter a mesma limitação
do canal oficial: quando o envio fica em dúvida, **ninguém pode reenviar automaticamente**, e
sobra reconciliação humana. Uma tarefa inteira sai do plano.

## 3. Gabriel precisa decidir?

Sim — **autorizar o envio real** e escolher qual das duas formas abaixo usar.

## 4. Recomendação

A **forma A** (número dedicado). A forma B mexe na sessão que atende cliente de verdade.

## 5. Estado

Aguardando você rodar. Resultado vai na §"Resultado", no fim.

---

# ⚠️ Antes de qualquer coisa: o risco que existe aqui

A sessão do WhatsApp vive **na memória do processo do serviço**. Um script separado não enxerga
a sessão que está no ar — ele precisa abrir a própria conexão usando as credenciais salvas.

E hoje **só existe uma sessão conectada: a do `adv-gac`** — o tenant que atende de verdade.

Abrir uma segunda conexão com as credenciais dela pode **derrubar o atendimento real**. Por isso
o script tem uma trava que recusa rodar sem uma confirmação explícita, e por isso a forma A é a
recomendada.

---

# Forma A — número dedicado (recomendada)

Você precisa de **dois WhatsApp**: um que envia (vai ser pareado no Hermes) e um que recebe (pode
ser o seu pessoal).

### Passo 1 — criar a sessão de teste

Entre no Hermes, vá em **Canais** e crie uma conexão nova. Pareie com o número **de teste** — não
com o número que atende cliente.

Anote o id da sessão. Se preferir pelo terminal:

```bash
sqlite3 -header /home/pi/projects/produto-hermes/dev.db "SELECT cs.id, t.slug, cs.status FROM ChannelSession cs JOIN Tenant t ON t.id = cs.tenantId WHERE cs.status = 'conectado';"
```

### Passo 2 — parar o serviço

Duas conexões com as mesmas credenciais brigam. Com o serviço parado, o spike fica sozinho.

```bash
systemctl --user stop hermes
```

> Enquanto isso o Hermes fica fora do ar. Leva poucos minutos.

### Passo 3 — rodar o spike

Troque `<ID_DA_SESSAO>` e `<NUMERO_QUE_RECEBE>` (só dígitos, com DDI e DDD):

```bash
cd /home/pi/projects/produto-hermes && SPIKE_SESSION_ID=<ID_DA_SESSAO> SPIKE_TO=<NUMERO_QUE_RECEBE> SPIKE_EU_SEI_O_QUE_ESTOU_FAZENDO=sim npx tsx scripts/spike-baileys-messageid.ts
```

### Passo 4 — olhar o aparelho

**Esta é a parte que importa.** O terminal responde metade da pergunta; o aparelho responde a
outra metade.

No celular que recebeu, conte as mensagens de teste:

- **uma bolha** → o WhatsApp deduplicou pelo id. **A hipótese se confirma.**
- **duas bolhas** → o id não impede a segunda entrega. **A hipótese cai.**

### Passo 5 — religar o serviço

```bash
systemctl --user start hermes
```

E confira que voltou:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:5173/health
```

Esperado: `200`.

---

# Forma B — usar a sessão que já existe (**não recomendada**)

Só se você não tiver um segundo número. Envolve parar o serviço e abrir a conexão com as
credenciais do `adv-gac` — o tenant que atende cliente.

**Riscos reais:** o WhatsApp pode encerrar a sessão e pedir QR de novo; o atendimento fica fora
do ar durante o teste; e uma mensagem de teste sai do número da empresa. Se você escolher esta,
me avise antes que eu preparo o passo a passo com o cuidado extra.

---

# O que o spike precisa do código

O `sendText` do produto **não** expõe o `messageId` — e não deve expor, porque a pergunta aqui é
sobre a biblioteca, não sobre o nosso código. O script fala com o socket direto, e para isso
precisa de um acessório de leitura em `baileys.server.ts`:

```ts
/** SÓ PARA O SPIKE T2. Não usar em código de produção. */
export function __socketDaSessaoParaSpike(sessionId: string) {
  return sessions.get(sessionId)?.sock ?? null
}
```

**Eu não adicionei isso ainda** — é uma linha de código de produção, e o combinado é que o spike
não altera código sem você. Se aprovar a forma A, eu adiciono junto com um comentário dizendo
que é temporário, e removo depois que o resultado estiver anotado.

---

# Resultado

> Preencher depois de rodar.

| | |
|---|---|
| Data | |
| Sessão usada | |
| `key.id` devolvido no 1º envio | |
| Bateu com o id pedido? | |
| `key.id` devolvido no 2º envio | |
| **Bolhas no aparelho** | |
| **Veredito** | |

### Se der UMA bolha

A hipótese se confirma. **T3 entra no plano:** o `sendText` passa a aceitar um id derivado do
`WebhookEvent.messageId`, e o canal QR ganha reenvio seguro — o ambíguo deixa de exigir olho
humano no canal que é padrão do produto.

### Se der DUAS bolhas

A hipótese cai. **T3 sai do plano**, e o documento principal precisa de dois ajustes:

1. a tabela "os dois canais têm garantias diferentes" passa a dizer que **nenhum** canal tem
   reenvio seguro;
2. a política fail-closed deixa de ser "por causa da Meta" e passa a valer para o produto
   inteiro — o que **aumenta** o peso da reconciliação humana e é argumento para reavaliar o
   `decision_prepared` (T7), que hoje está marcado como opcional.

Nos dois casos o resultado é útil. Não existe desfecho ruim para este spike — existe desfecho
que muda o plano, e é para isso que ele serve.
