# 🎯 Plano — de onde estamos até o primeiro cliente pagante

> **Auditoria de 2026-08-03, revisada no mesmo dia (rev. 2) contra evidências de execução.**
> 5 dimensões auditadas no código e no serviço em produção, cada achado submetido a um
> verificador cético. A revisão 2 corrige afirmações da primeira versão que a execução
> desmentiu — elas estão listadas no §8 para que ninguém as reintroduza.
>
> **Gatilho:** o concorrente (Autimize) já está vendendo. Duas frentes: **Atlas** (R$ 97/mês,
> agente autônomo pessoal, IA em BYO-key) e **Autimize Chat** (R$ 297/mês, inbox multi-atendente,
> canal oficial via Embedded Signup).

---

## 0. O veredicto: temos produto, não temos negócio

**"Não temos produto" é falso.** Se faltasse produto, o plano seria de trimestres construindo.
Como falta *ligação*, é de semanas ligando.

Desde a primeira versão deste documento a cadeia inteira foi provada ponta a ponta, em produção,
com número real: QR novo conectado → inbound recebido → fila persistente processou → motor
respondeu → lead criado → tema de contrato acionou o guard determinístico `sensitive_topic` →
handoff registrado → outbound automático entregue → resposta humana pelo painel entregue.

Isso valida de uma vez o canal, a fila, o motor, os guard-rails e o painel. **Não é mais teoria.**

### O que está no ar e funcionando

| | Evidência |
|---|---|
| Cadeia ponta a ponta pelo QR | provada em produção (acima), com número real |
| Funil público respondendo | landing com preço, `/signup`, `/login`, `/verificar-email` em 200; rotas internas em 302 pro login |
| Provisionamento self-service | `/signup` cria Tenant + config + Account + Membership(owner) + trial numa transação idempotente e já devolve a pessoa logada. **Zero comando manual** |
| Fila durável | persiste antes do 200, dedup por `messageId`, claim atômico, requeue de órfão, sweeper de 60s |
| Guard-rails determinísticos | `sensitive_topic` disparou em produção; validador recusa ferramenta não habilitada e recusa resposta que finge ter registrado. A IA nunca toca o banco |
| Deploy versionado com rollback | releases datadas, `git archive` imune à working tree, snapshot antes de migration |
| Backup **local** diário | `sqlite3 .backup` + `PRAGMA integrity_check` que apaga o arquivo se falhar; rotação de 14 |
| Gate de regressão do motor | `npm run eval:gate` pontua, repete e compara baseline |
| Páginas legais escritas com seriedade | `/privacidade` separa controlador/operador, art. 33, subprocessadores; `/termos` tem disponibilidade e devolução proporcional |

---

## 1. O que já foi resolvido

| Item | Como foi fechado |
|---|---|
| **Cadeia ponta a ponta pelo QR nunca provada** | Provada em produção — sessão antiga invalidada, auth removido, QR novo conectado, inbound → fila → motor → lead → `sensitive_topic` → handoff → outbound → resposta humana |
| **Chaves Signal em log claro** | `8eaa8b3` — *fix(segurança): impede chaves Signal no log*. Log comprometido apagado, sessão WhatsApp renovada, novos logs sem `privKey`/`rootKey`. Verificado: **nunca entrou no histórico do git** (`hermes.log` está em `.gitignore:37`; nenhum commit além do próprio fix toca essas strings) |
| **Resposta humana duplicada** | `2482d57` — *fix(atendente): limpa resposta após envio*. Causa confirmada no banco (duas mensagens idênticas com 5s de diferença). Implantado |
| **`currentPeriodEnd` nunca renovado** | `ecaab7b` — *fix(billing): sincroniza próxima renovação do MP*. `getPreapproval` lê `next_payment_date`; `syncSubscriptionFromMp` grava `currentPeriodEnd`; data ausente/inválida **preserva** o período conhecido. Código revisado linha a linha: correto, inclusive o caso de borda. ⚠️ **Inerte até `MP_WEBHOOK_SECRET` existir** — ver §2 |
| **Tela congela em "reconectando"** | `69053a4` — *fix(canais): mantém polling na reconexão*. Polling cobre `pareando`, `verificando` e `reconectando` |
| **`ATTENDANT_PROVIDER` inválido caindo no mock em silêncio** | `d32ec2a` — *fix(atendente): rejeita provider inválido*. Nome inválido não cai mais no mock; em produção, provider ausente também é erro; o cliente recebe fallback seguro com handoff; telemetria registra `invalid`. 628 testes, typecheck, lint e build passaram. Release implantada `20260803-200033` |
| **"Cérebro inviável por latência"** | **Afirmação retirada.** Ver §8 |

### O Claude CLI, medido corretamente

Com o `.env` real de produção — timeout **60s**, concorrência **1** — o resultado é
**9/9 cenários DGC aprovados, 0% de fallback, latência entre 10,8s e 15,7s**.

Conclusão registrada:

- **aceitável temporariamente** para um piloto assistido de baixo volume;
- **não aceitável** para escala ou SLA comercial;
- a Anthropic API continua sendo o destino comercial, mas **não bloqueia um único piloto
  controlado**.

O que **continua de pé** não é performance, é **fornecimento**: o motor depende de uma credencial
pessoal que já expirou uma vez e exigiu relogin manual, e não existe contrato comercial por trás
dela. Enquanto o piloto for assistido, é risco operacional aceitável. A partir do momento em que
alguém pagar, a pergunta de venda que usamos contra o Atlas — *"seu atendente pode parar amanhã
por decisão de um fornecedor que não é seu?"* — passa a valer contra nós. Isso não muda a ordem do
plano; muda **o que pode ser prometido por escrito** antes da virada para a API.

---

## 2. Bloqueios externos (dependem do Gabriel)

Nenhuma linha de código destrava qualquer um destes.

### 2.1 Mercado Pago — credencial configurada, cobrança **não** validada

Estado verificável hoje:

- **existe uma credencial do Mercado Pago configurada, aparentemente fora do formato de teste;**
- **não há prova ponta a ponta** de assinatura, webhook, renovação, atraso, cancelamento e
  reativação;
- **`MP_WEBHOOK_SECRET` continua ausente;**
- **`BILLING_GATE_ENABLED` continua desligado.**

> Nenhum token ou fragmento de token é registrado neste documento.

> ⚠️ **O risco de ordem não morreu; mudou de dono.** `syncSubscriptionFromMp` só é chamado pelo
> webhook, e o webhook é fail-closed: sem `MP_WEBHOOK_SECRET` responde 401 a 100% das notificações
> ([webhook.mercadopago.tsx:38](../app/routes/webhook.mercadopago.tsx#L38)). O fix `ecaab7b` está
> correto e **inerte** até o secret existir. Ligar o gate antes disso reproduz o desastre original:
> `currentPeriodEnd` nunca atualiza porque o sync nunca roda.

### 2.2 `MP_WEBHOOK_SECRET`

Criar no painel do MP e configurar. Sem ele não há renovação, e portanto não há assinatura que
sobreviva ao segundo mês.

### 2.3 Dados legais reais

Os 8 campos de `LEGAL_ENTITY` em [legal.ts:18](../app/lib/legal.ts#L18). O bloqueio é o **dado**
(CPF/CNPJ, e-mail do encarregado/DPO, comarca, hospedagem), não o código — a edição é trivial
assim que existirem. Enquanto isso, os marcadores aparecem em tarja na página imediatamente
anterior a digitar o cartão.

### 2.4 Domínio próprio e remetente de e-mail

Enquanto o remetente for o domínio de teste do Resend, a API recusa qualquer destinatário que não
seja o dono da conta — **nenhum estranho recebe confirmação de cadastro nem redefinição de senha**.
Domínio próprio também tira o host de túnel da barra do navegador na hora de digitar o cartão.

### 2.5 Decisão/conta Anthropic para produção comercial

Não bloqueia o piloto único assistido. Bloqueia escala, SLA e qualquer promessa contratual de
disponibilidade. É também o que torna verdadeira a nossa frase de venda contra o BYO-key.

### 2.6 Relógios que não dependem de trabalho

CNPJ (a venda B2B vai querer nota fiscal), registro do domínio, e Business Verification + App
Review na Meta. São **fila, não código** — cada semana adiada é uma semana em que o concorrente
conecta o canal oficial em 2 minutos e nós não.

---

## 3. Bloqueios de código realmente restantes

### 3.1 Impedem a venda acontecer

- **Não existe como o cliente testar a própria IA sem apontar o WhatsApp da empresa.**
  `processIncomingMessage` já aceita qualquer tenant; falta a rota autenticada. **É a próxima
  tarefa** (§4).
- **Onboarding sem conteúdo** — falta o roteiro de perguntas em português comum que vira o
  primeiro documento da base, e templates por segmento em vez de campo em branco.
- **"Abrir chamado" fora do checklist de onboarding** — dá para concluir o onboarding com a
  ferramenta desligada, e aí o validador descarta toda proposta de chamado em silêncio.

### 3.2 Impedem a cobrança funcionar quando o gate for ligado

- **O grandfathering não cobre os tenants que existem.**
  [billing-gate.server.ts:28](../app/lib/billing-gate.server.ts#L28) isenta tenant **sem**
  `Subscription`. Estado do banco: **7 tenants no total; 3 tenants de trial estão sem documentos e
  com `currentPeriodEnd` vencido** — `adv-gac`, `advocacia-primo` e `qr-teste`.
  **O QR conectado pertence ao `adv-gac`.** Portanto ligar o billing gate agora **realmente
  bloquearia esse atendimento**.
- **Não existe e-mail de fim de teste** (D-3/D-0). O trial vence e nada acontece.

### 3.3 Margem — quando a conta Anthropic existir

- Prompt caching nos blocos estáveis (regras + config + base de conhecimento).
- Campos de custo/token no `MessageTrace`.
- `ANTHROPIC_MODEL` explicitamente em sonnet: o default no código é `claude-opus-4-8`
  ([anthropic-api.server.ts:13](../app/lib/attendant/providers/anthropic-api.server.ts#L13)).

Sem os dois primeiros, "IA inclusa a R$ 149" é aposta às cegas.

### 3.4 Rede de segurança

- `/health` + monitor **externo ao Pi** — processo morto não alarma.
- **Avisar o cliente** quando o canal dele cai (hoje a notificação vai só para o dono).
- **Sessão `derrubado` exige ação humana.** O comportamento real, para registro correto:
  quedas recuperáveis **têm retry automático com backoff**; o boot **retoma** os estados
  `conectado` e `reconectando`; depois de esgotar tentativas ou entrar em estado terminal, a
  sessão vira `derrubado` — e **esse** estado não é retomado automaticamente. Não é verdade que
  falte reconexão automática; o que falta é o tratamento do estado terminal.
- Backup **off-site** — as cópias existem, mas vivem no mesmo disco do banco.
- Runbook de restore escrito e **ensaiado uma vez, cronometrado**.

---

## 4. A próxima tarefa de código: rota autenticada "Testar minha IA"

Uma tela dentro da conta do cliente que chama `processIncomingMessage` no tenant dele com
`channel='simulator'`, **sem exigir WhatsApp conectado**.

### Por que esta e não outra

A prova real de cobrança está bloqueada primeiro por configuração externa (`MP_WEBHOOK_SECRET` e
ciclo real no Mercado Pago). Enquanto essa trilha depende do Gabriel, a próxima linha de código
deve destravar a *venda*. A prova ponta a ponta foi feita pelo dono, com o WhatsApp real; **um
prospect não faz isso**. Esta rota converte um produto **provado** num produto **demonstrável**, e é
o passo do qual o roteiro do primeiro piloto depende literalmente.

É também a mais barata das candidatas: a peça de servidor já aceita qualquer tenant e a demo
pública já a chama. As alternativas dependem do Gabriel primeiro (prompt caching precisa da conta
Anthropic; e-mails de trial precisam do domínio) ou são rede de segurança para um piloto que estará
assistido.

### Critérios observáveis de pronto

1. **Somente usuário autenticado acessa.**
2. **O tenant vem exclusivamente da sessão autenticada** — nunca de `tenantSlug` enviado pelo
   formulário ou pela URL.
3. A conversa usa `channel='simulator'`.
4. O usuário só pode consultar e continuar conversas **do próprio tenant** e da identidade interna
   de teste dele.
5. **Com base vazia, não chama a IA:** a tela **bloqueia** o teste, explica que ainda faltam
   informações da empresa e oferece link direto para Conhecimento/Configurações. Não chama o
   provider e não produz resposta genérica como se conhecesse o negócio. O teste é liberado depois
   de existir **ao menos um documento válido**.
6. Com conhecimento cadastrado, **três perguntas representativas** passam pelo motor configurado e
   persistem `Conversation`, `Message` e `MessageTrace`.
7. `MessageTrace` registra **provider real, `outcome` e `brainMs`**. Resultado `mock` ou `invalid`
   **reprova** a prova de produção.
8. **Testes comprovam isolamento entre dois tenants.**
9. Não exige WhatsApp conectado.
10. Reaproveita componentes e padrões da demo pública **sem expor tenants reais nela**.
11. Não altera demo pública, billing gate, provider ou canal WhatsApp fora do necessário.
12. **O teste humano final é obrigatório** — alguém que não é o dono nem o Danilo faz o percurso
    sozinho. Perguntas sobre **conteúdo ausente não reprovam** a navegação: a tela deve orientar
    claramente.

### Como conferir no banco (esquema real)

`Message` **não** tem `tenantId` nem `channel` — esses campos ficam em `Conversation`. A conferência
exige JOIN:

```sql
SELECT c.tenantId, c.channel, m.role, m.createdAt
FROM Message m
JOIN Conversation c ON c.id = m.conversationId
WHERE c.channel = 'simulator';
```

`MessageTrace` tem `tenantId`, `conversationId`, `channel`, `provider`, `outcome` e `brainMs` —
pode ser consultado diretamente, e é onde se verifica o critério 7.

---

## 5. Sequência revisada do primeiro piloto

A ordem mudou: o que era "M1 destrava a cobrança" virou **duas trilhas paralelas** — a do Gabriel
(externa, com relógios) e a de código (que agora começa pela demonstrabilidade, não pela cobrança).

| # | Passo | Trilha | Depende de |
|---|---|---|---|
| 1 | **"Testar minha IA"** (§4) | código | nada — pode começar já |
| 2 | Onboarding com roteiro + templates + "abrir chamado" no checklist | código | passo 1 |
| 3 | `MP_WEBHOOK_SECRET` + prova ponta a ponta de cobrança (assinatura, webhook, renovação, atraso, cancelamento, reativação) | Gabriel | 2.1/2.2 |
| 4 | Dados legais reais; domínio próprio + remetente verificado | Gabriel | 2.3/2.4 |
| 5 | **Piloto assistido do primeiro cliente**, sem cobrar, no Claude CLI | ambas | 1, 2 |
| 6 | E-mails de fim de teste + grandfathering corrigido para os 3 tenants vencidos | código | 3 |
| 7 | Ligar `BILLING_GATE_ENABLED` | Gabriel | 3 **e** 6, nunca antes |
| 8 | Virada para Anthropic API + prompt caching + custo por mensagem | ambas | 2.5 |

**Regras de sequência que não se negociam:**

- O piloto (passo 5) roda **assistido e sem cobrança** enquanto o motor estiver no Claude CLI.
  Cobrar antes do passo 8 significa vender um SLA que a credencial pessoal não sustenta.
- O gate (passo 7) só depois do secret **e** do grandfathering. Hoje ele derrubaria o `adv-gac`,
  que é justamente o tenant com QR conectado.
- Sem tráfego pago antes do terceiro pagante.

---

## 6. Como ficamos melhores que eles

### 6.1 A fronteira que o Atlas não consegue cruzar

**"O Atlas é o seu assistente. O Hermes é o seu atendente."**

É a arquitetura deles: o onboarding pede *"o número que **você** usa no WhatsApp"* e o prompt deles
começa com *"Você é o agente de IA pessoal de {nome}"*. **Não existe inbox, não existe fila, não
existe contato desconhecido.** O caso de uso "responda clientes" da home deles não tem canal por
onde acontecer — para isso a PME precisa comprar **também** o Autimize Chat: +R$ 297, outro
cadastro, outro pagamento, com teto rígido que exibe na tela do próprio cliente *"Novos contatos
deixaram de ser recebidos — X conversa(s) perdida(s) este mês"*.

O Hermes entrega canal, cérebro e fila de humano **num cadastro só** — e agora isso está provado
ponta a ponta, não prometido.

### 6.2 IA inclusa de verdade — sem chave de API, sem cartão em dólar

O BYO-key é fricção fatal no público que eles dizem atender. O atalho barato deles (plugar a
assinatura pessoal de ChatGPT/Claude via OAuth) é instável por construção — o código deles tem um
erro `cloudflare_blocked` e um aviso pedindo para *"evitar usar o ChatGPT/Claude em paralelo
durante o teste"*.

> **Honestidade interna:** hoje o Hermes comete o mesmo pecado, só que escondido. O passo 8 da
> sequência é o que torna essa frase verdadeira — e até lá ela não deve ser usada por escrito.

### 6.3 Preço plano por empresa

Umbler cobra R$ 79 por atendente, Blip R$ 100-150 por atendente extra, Zenvia R$ 0,86-2,50 por
interação mais canal à parte, Autimize Chat R$ 50 por bloco extra. **Todos punem o cliente por
crescer.** E desde 01/07/2025 as mensagens não-template dentro da janela de atendimento são
gratuitas na Meta: atendimento reativo tem custo de canal próximo de zero.

### 6.4 O guard-rail vira promessa de capa

**"A IA nunca inventa preço, prazo ou promessa — quando não sabe, ela te chama com a ficha do
cliente pronta na tela."** É o medo nº 1 de quem cogita botar robô falando com cliente, e ninguém
na faixa de entrada responde a ele. Já temos a terceira via construída — e o `sensitive_topic`
disparando em produção é a prova que faltava.

### 6.5 Prestação de contas semanal

O Atlas promete escopo infinito e **não mede nada** — a home inteira não tem um único número.
É também o antídoto contra o concorrente de R$ 0: a Meta lançou o **Business AI grátis** no app do
WhatsApp Business no Brasil em 24/02/2026. Ele responde — mas não registra caso, não qualifica, não
escala com contexto e **não presta contas**.

---

## 7. Preço: manter R$ 149. Mudar a embalagem, não o número

O mercado já educou a faixa self-service em R$ 99-199 (SocialHub R$ 99/199/399; BotConversa
R$ 189-199) — e nesses, **a IA só aparece a partir de R$ 199**. Acima, só venda consultiva com
contrato de 12 meses (Poli a partir de R$ 829,90; Huggy R$ 989; Zenvia R$ 600-3.900 + canal +
ativação). **Não há espaço entre R$ 149 e R$ 829.**

A comparação honesta na página de preço:

> "R$ 97 **+ uma fatura variável em dólar que você administra + R$ 297** se quiser que ele fale com
> o seu cliente" **contra** "R$ 149, uma conta, sem criar conta em lugar nenhum".

| | |
|---|---|
| **Essencial R$ 149** | 1 número, usuários e atendimentos **ilimitados**, teto declarado de mensagens de IA. Ao atingir o teto **não bloqueia** — passa a escalar para humano, e avisa em 80% |
| **Pro R$ 299** | vários números, relatório semanal, suporte prioritário, teto ~4x |
| **Anual R$ 1.490** | 2 meses grátis, pago no Pix (pagamento único) |
| **Fundador** | 5 primeiras a R$ 99 travados por 12 meses, em troca de depoimento. Finita e datada |

> ⚠️ **Ressalva de margem.** O teto só pode ser publicado depois de medido o custo por mensagem
> (§3.3). Com `claude-opus-4-8` e sem prompt caching, "IA inclusa" viraria prejuízo por cliente — e
> o BYO-key do Atlas passaria a ser o modelo economicamente correto.

**O que não fazer:** baixar para R$ 97. Você perde a margem que paga a IA e entra numa guerra de
preço contra alguém que **não paga a IA**.

---

## 8. Premissas removidas ou corrigidas na revisão 2

Registradas para que ninguém as reintroduza a partir da versão anterior deste documento.

| Afirmação da rev. 1 | Correção |
|---|---|
| "O token do MP é de um usuário de teste da sandbox — o botão Assinar é decorativo" | **Removida.** Existe credencial configurada, aparentemente fora do formato de teste. Isso **não** prova cobrança validada: falta prova ponta a ponta de assinatura, webhook, renovação, atraso, cancelamento e reativação. Nenhum token ou fragmento é registrado aqui |
| "44,4% de fallback, p50 46,6s — o cérebro não aguenta" | **Removida.** Foi medida com concorrência 2 e configuração de eval diferente da produção. Com o `.env` real: **9/9, 0% de fallback, 10,8-15,7s**. O que sobrevive é fornecimento (credencial pessoal, sem contrato), não performance |
| "3 de 3 cadastros self-service pararam com 0 documentos" | **Removida** — não foi provado que esses três representam todos os cadastros self-service. Fato: **7 tenants no banco; 3 de trial sem documentos e com `currentPeriodEnd` vencido** (`adv-gac`, `advocacia-primo`, `qr-teste`) |
| "Com a base vazia, a tela diz o que fazer" (como critério de resposta correta) | **Corrigida.** Com base vazia a tela **bloqueia** o teste e não chama o provider — o critério anterior incentivaria alucinação |
| Critério com `SELECT ... FROM Message WHERE channel='simulator'` | **Corrigido.** `Message` não tem `tenantId` nem `channel`; ficam em `Conversation`. Exige JOIN (§4) |
| "Uma queda de rede mata o canal até alguém clicar em Reconectar; nem reiniciar recupera" | **Corrigida.** Quedas recuperáveis têm retry automático com backoff e o boot retoma `conectado` e `reconectando`. Só o estado terminal `derrubado` exige ação humana |
| "`currentPeriodEnd` nunca renovado" | **Resolvida** por `ecaab7b` — mas **inerte** sem `MP_WEBHOOK_SECRET` |
| "QR congela em reconectando" | **Resolvida** por `69053a4` |
| "`ATTENDANT_PROVIDER` inválido cai no mock em silêncio" | **Resolvida** por `d32ec2a`, release `20260803-200033` |
| "Smoke test do inbound real por QR nunca aconteceu" | **Resolvida** — cadeia provada ponta a ponta em produção |

---

## 9. Riscos

| Risco | Por quê |
|---|---|
| 🔴 **Ligar o gate cedo** | Sem `MP_WEBHOOK_SECRET`, `currentPeriodEnd` nunca atualiza (o fix é inerte). E o grandfathering não cobre os 3 tenants vencidos — **`adv-gac`, que tem o QR conectado, para de atender** |
| 🔴 **Cobrar antes da virada de provider** | O motor roda em credencial pessoal, sem contrato comercial, que já expirou uma vez e exigiu relogin manual. Vender SLA sobre isso é o pecado que criticamos no Atlas |
| 🟠 **CNPJ e App Review são fila, não código** | Se o relógio não começar já, atrasa a venda B2B por semanas por mais rápido que o resto ande |
| 🟠 **Ban no número do cliente** | O QR viola explicitamente os WhatsApp Business Terms. O passivo real é o ban acontecer no número do **cliente pagante**, irreversível, levando o histórico junto |
| 🟠 **O Pi é ponto único de falha** | Caiu durante a auditoria sem nada alarmar; under-voltage, swap quase cheia, 77°C, dividindo a máquina com o bot de trading. §3.4 cobre a rede de segurança, **não** a troca de infra |
| 🟠 **Ninguém de fora atravessou o funil** | O critério 12 de §4 existe exatamente para que a primeira pessoa a descobrir os defeitos não seja o cliente pagante. Se for verificado pelo próprio dono "porque é mais rápido", não está pronto |
| 🟠 **Meta Business AI grátis (24/02/2026)** | Toda manchete "IA que responde seus clientes" passa a competir com R$ 0 e perde. Sem a cunha de **registrar, qualificar, escalar e prestar contas**, nenhum conserto técnico compensa |
| 🟡 **Uma pessoa e meia** | Se a trilha de rede de segurança não for realmente delegada ao Danilo, vira caminho crítico do dono |
