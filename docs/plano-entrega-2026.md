# 📦 Plano de Entrega — Hermes pagável (jul→dez 2026)

> **A meta:** a 1ª mensalidade na conta até dezembro de 2026 — contrato assinado, NF emitida,
> serviço rodando sem depender de sorte.
>
> Este plano nasceu de uma auditoria multi-agente (2026-07-02): 6 leitores mapearam cada
> subsistema, 5 analistas cruzaram o mapa contra a pergunta *"o que bloqueia cobrar
> mensalidade?"*, e cada achado grave passou por um verificador cético que só confirmou com
> evidência no código. Resultado: **20 bloqueios confirmados**, 3 achados rebaixados, 1 refutado.
>
> Ele **estende** o [plano-de-voo.md](plano-de-voo.md) (que continua valendo como bússola diária)
> com a régua mais alta: não é só "1º cliente", é **produto que alguém paga por mês sem você
> passar vergonha**.

---

## 🟢 Onde o produto realmente está (mais forte do que parece)

A auditoria confirmou no código — não é otimismo:

- **O princípio "IA propõe, balcão executa" é real.** A action `abrir_chamado` só vira linha no
  banco depois do validador (tool habilitada + limites do config) e do dedup determinístico.
  A IA nunca toca o banco.
- **Fallback em camadas genuinamente seguro** — provider quebra ou JSON inválido → resposta
  segura + `needs_human` + alarme com cooldown. Degradação não é mais silenciosa.
- **Webhook fail-closed**: HMAC em tempo constante, verify token, rate-limit antes de trabalho
  caro. Acima da média pra MVP.
- **Auth multi-tenant de DADOS já existe e está correto** — operador pertence a tenant, sessão
  carrega o tenant, toda query das telas internas escopa por `tenantId` no WHERE. (O furo é
  outro — ver bloqueio S2.)
- **228 testes em 26 arquivos, todos passando.** Lógica de negócio pura e testada isolada,
  como o CLAUDE.md manda.
- **Cadeia ponta a ponta funciona hoje**: funnel TLS → assinatura → motor → SQLite, sem IP fixo.
- **Banco de provas do cérebro real** (`npm run eval:motor`) com cenários csmed — poucos
  produtos desse tamanho têm eval do motor.
- **Dashboard com tese de venda**: o número-herói é a autonomia da IA — exatamente o argumento
  comercial.

## 🔄 Crenças corrigidas pela auditoria (atualize o modelo mental)

| Acreditávamos | A verdade verificada |
|---|---|
| "Falta token permanente da Meta" | ✅ **JÁ É PERMANENTE** — `debug_token` na Graph API retornou `type=SYSTEM_USER, expires_at=0`. Pendência morta nos docs e na memória. Falta só *regenerar* (o atual passou por chat). |
| "Auth multi-tenant pendente" (memória) vs "Auth multi-tenant ✅" (plano-de-voo) | Meio a meio: isolamento de **dados** existe e está certo; isolamento de **credencial** não — todos os tenants nascem com a MESMA senha seed. |
| "Latência ~17s" | **21,7s média / 30,7s pior caso** (eval de 2026-07-02) — o pior caso estoura o timeout de 30s e gera fallback falso. |
| "Latência é gravidade alta" | Rebaixada: é o gargalo nº1 de experiência, mas não bloqueia cobrar do cliente 1. Mitigação imediata: subir `ATTENDANT_TIMEOUT_MS`. |

---

## 🔴 Os 20 bloqueios confirmados (o que impede mandar boleto)

Cada um foi confirmado por um verificador adversarial com evidência no repo. Agrupados por tema;
esforço entre parênteses.

### Motor & qualidade do atendimento

| # | Bloqueio | Evidência | Esforço |
|---|---|---|---|
| M1 | **Latência 21,7s média / 30,7s pior caso** — pior caso estoura o timeout de 30s → fallback falso. Propor→confirmar = 40–90s acumulados por demanda. | `eval-report.md` (run real) | dias (estrutural: anthropic_api) |
| M2 | **Áudio do cliente vira vácuo** — `parseInboundMessages` só aceita `type==='text'`; nota de voz é ignorada SEM resposta. Público do csmed (famílias, plantonistas) manda áudio. A transcrição faster-whisper JÁ EXISTE, falta o elo. | `whatsapp.server.ts:80` | dias |
| M3 | **`abrir_chamado` — o coração do produto — nunca foi provado ponta a ponta no csmed**: 0 de 7 cenários abriram chamado no eval real; nenhum cenário multi-turno de confirmação; `requireConfirmation` é parseado mas nenhum validador aplica. | `eval-report.md`, `validate.ts:92-142` | dias |
| M4 | **Guard de saúde com furo de plural**: "dores/sintomas/exames" NÃO disparam os triggers "dor/sintoma/exame" (`\b` casa palavra inteira); e a resposta de emergência não cita 192/SAMU nem alarma ninguém. | `handoff.ts:28`, `csmed.json:44-58` | horas |

### Segurança & LGPD

| # | Bloqueio | Evidência | Esforço |
|---|---|---|---|
| S1 | **Zero LGPD pra dado sensível de saúde**: sem aviso de IA/tratamento na 1ª interação, sem consentimento, sem retenção/expurgo, sem política de privacidade. Conversas de home care = dado sensível (art. 11). | grep vazio em `app/`; `SECURITY-BACKLOG.md:105` | dias |
| S2 | **Senha de operador compartilhada entre TODOS os tenants** — seed única `OPERATOR_SEED_PASSWORD` com default fraco `'hermes-dev'` sem fail-closed, username = slug (adivinhável), sem rate-limit no login. Quem sabe a senha da CS MED entra na Prestacon. | `operators.server.ts:73` | dias |
| S3 | **Motor roda na assinatura Claude PESSOAL (claude_cli)** — cobrar cliente = uso comercial vetado por ToS, dado de saúde de terceiro sem base contratual, e sem custo unitário conhecido. O provider `anthropic_api` (item 2.6 da fase 2, "obrigatório antes de cliente real") não existe. | `attendant/index.ts:24-30`, `.env` | dias |
| S4 | **Token da Meta comprometido (passou por chat) e nunca regenerado** — é a credencial que ENVIA mensagens em nome do cliente. | `plano-de-voo.md:50` (checkbox aberto) | horas |
| S5 | **Banco em cópia única, sem backup, dentro da working tree** — `git clean -fdx` removeria `dev.db` E `.env` (confirmado em dry-run). Perder conversas de saúde = incidente reportável (art. 46/48). | crontab sem job Hermes; `.gitignore:12` | horas |

### Confiabilidade & operação

| # | Bloqueio | Evidência | Esforço |
|---|---|---|---|
| C1 | **Ninguém fica sabendo quando cai**: `ALARM_WEBHOOK_URL` não está no `.env` real (alarme desarmado), zero monitor externo, e falha de envio é silenciosa (`sendWhatsAppMessage` devolve `false` ignorado). | `.env`, `webhook.whatsapp.tsx:50` | horas |
| C2 | **Webhook sem idempotência nem persistência**: `messageId` da Meta parseado e nunca usado → redelivery duplica resposta; `void handleInbound` após o 200 → restart no meio perde a mensagem pra sempre. | `whatsapp.server.ts:81,89` | dias |
| C3 | **"Produção" é o vite dev server sobre a working tree mutável** — HMR ativo: um `git checkout` muda o atendimento AO VIVO. E o caminho pro build está quebrado (`.env` só carrega em `command==='serve'`; `DATABASE_URL` relativo cria banco fantasma). | `hermes.service:16`, `vite.config.ts:21`, `db.server.ts:4` | horas |

### Comercial (onde quase nada existe)

| # | Bloqueio | Evidência | Esforço |
|---|---|---|---|
| P1 | **Preço e modelo de cobrança nunca foram definidos** — "Em aberto" desde jun/2026, e a base de custo (Meta + LLM por conversa) nunca foi medida. | `regra-de-negocio.md:36` | horas (decisão) |
| P2 | **Sem contrato, termos de uso ou papelada LGPD** — pra cobrar da CS MED o Hermes vira operador de dados de um controlador de saúde. Mínimo: contrato simples + anexo de tratamento de dados. | find vazio no repo | dias |
| P3 | = S3 (assinatura pessoal impede faturar e precificar) | | |

### Replicabilidade (o que impede o cliente 2 de ser barato)

| # | Bloqueio | Evidência | Esforço |
|---|---|---|---|
| R1 | **Processo Meta do número de produção não iniciado** — hoje é número de TESTE que só fala com números pré-cadastrados. Verificação de negócio leva dias a semanas: **caminho crítico do calendário**. | `whatsapp-token-permanente.md:72-80` | semanas (calendário) |
| R2 | = S2 (onboardar tenant novo distribui a senha de todos) | | |
| R3 | **Onboardar cliente o publica na demo pública** — `/demo/chat` sem login lista TODOS os `INITIAL_TENANTS` (csmed incluso) e escreve no banco REAL: qualquer visitante polui a fila e as métricas pelas quais o cliente paga. Item 3 do SECURITY-BACKLOG. | `demo.chat.tsx:5,14` | horas |

## 🟡 Não bloqueia, mas mina a confiança (fazer no caminho)

- **`neverPromise` por substring rejeita a resposta CERTA**: "não fazemos diagnóstico" derruba a
  mensagem inteira porque `'diagnostico'` está na lista do csmed — e a própria base ensina essa
  frase (`validate.ts:178`).
- **Trigger global `'pessoa'` sequestra o lead mais valioso do home care**: "preciso de uma
  PESSOA pra cuidar da minha mãe" escala como pedido de humano; tenant não consegue desligar
  trigger global (`handoff.ts:10,48-51`).
- **`answer_only_from_knowledge` é promessa de prompt, não guard-rail**: `no_knowledge_match`
  não força nada — contradiz o princípio declarado E o playbook, que promete "fora da base →
  escala automaticamente" (falso hoje).
- **Chamado/lead da IA executam mesmo quando o guard descarta a resposta dela** — chamado
  fantasma que o cliente não viu (`conversation.server.ts:237-269` antes do gate `:273`).
- **Guard não curto-circuita o LLM**: paga os ~22s mesmo quando `requested_human`/`sensitive_topic`
  já decidiram a resposta.
- **Config decorativa exposta na tela**: `forbiddenTopics`, `maxDiscountPercent`,
  `requireConfirmation` são parseados/preservados mas nenhum código aplica — garantia falsa
  se vendida ao cliente.
- **Eval dá verde com fallback**: `fellToFallback` é calculado e não assertado — cenário que caiu
  em `provider_error` passou.
- **Regex de trigger sem escape** (`handoff.ts:28`): um trigger com `(`/`+`/`?` no JSON derruba
  TODA mensagem do tenant (compare `lead.ts:33-39`, que escapa).
- **`extractLeadPatch` clobbera o `need`**: um "ok, obrigado" sobrescreve a necessidade real.
- **Métrica de autonomia mente**: conta status atual, não `HandoffEvent` no histórico — e esse
  número vai pra proposta comercial.
- **Rate-limit global único em memória**: um tenant barulhento gera 429 pra todos (ok pro
  cliente 1, quebra com 10).
- **Amarras de vertical ainda no código**: `NEIGHBORHOODS` (bairros SP), `URGENCY_TERMS`,
  gatilhos "geladeira/ar-condicionado" hardcoded (`lead.ts:11-23`, `response.ts:13-26`).
- **`channel:'simulator'` mesmo vindo do WhatsApp real** (`conversation.server.ts:114`) —
  contamina métrica antes do piloto gerar dados.
- **`saveTenantConfig` sobrescreve sem versionamento/backup** — config de produção do cliente.
- **69 commits à frente da main sem estratégia de merge** + produção servida da working tree =
  um merge malfeito muda o atendimento ao vivo.

---

## ✈️ O roadmap — julho a dezembro de 2026

Capacidade real: 1 dono part-time + Danilo por PR (zonas 🟢🟡🔴). Cada marco tem critério de
pronto mensurável. Os marcos de **negócio** estão destacados — eles importam tanto quanto os de
código.

### 1ª quinzena de julho — Fundação operacional (parar de voar às cegas)
- [x] **Backup diário automatizado** do `dev.db`: `scripts/backup-db.sh` (`.backup` +
      `integrity_check` + `.env` junto + rotação 14) no cron 03:50, restore provado por contagem;
      `DATABASE_URL` absoluto no `.env` e banco-fantasma `prisma/dev.db` removido. *(S5)*
      ✅ *feito em 2026-07-02 — cópia pra fora do Pi ainda pendente (decisão de destino)*
- [x] **Armar os alarmes**: `ALARM_WEBHOOK_URL` → ntfy (tópico `hermes-dgc-c59f3705`, provado
      ponta a ponta) + alarme quando `sendWhatsAppMessage` devolve `false`. *(C1)*
      ✅ *feito em 2026-07-02 — falta VOCÊ assinar o tópico no app ntfy do celular*
- [ ] **Monitor externo grátis** (UptimeRobot, tipo *keyword* = `Forbidden` na URL pública do
      webhook) — ⚠️ *configurado mas marcando DOWN mesmo com o endpoint saudável (verificado
      2026-07-02: 403+`Forbidden` ok por fora). Diagnosticar a config do monitor (suspeito nº1:
      "Alert when" invertido pra "Keyword Exists"). Pausado a pedido do dono.* *(C1)*
- [x] **Mitigar latência em minutos**: `ATTENDANT_TIMEOUT_MS=45000` no `.env` (pior caso medido
      era 30,7s) — elimina o fallback falso por timeout. *(M1 parcial)* ✅ *2026-07-02*
- [x] **Curto-circuito do guard**: `requested_human`/`sensitive_topic` retornam a resposta segura
      SEM chamar o LLM e sem executar lead/chamado da proposta descartada (mata o
      chamado-fantasma junto). Testes em `conversation.guard.test.ts`. ✅ *2026-07-02*
- [x] **`hermes.service` → build de produção**: unit roda `node --env-file-if-exists=.env
      server.js` (`NODE_ENV=production`), servindo o build congelado por HTTPS na 5173 —
      topologia pública intacta (mesmo funnel, cookie Secure e mic preservados). `.env` via Node
      nativo (some o gancho do vite-só-em-dev). Provado E2E: handshake da Meta pela URL pública →
      200. Unit versionado em `deploy/`. *(C3)* ✅ *2026-07-02*
- [x] **Commitar o que está solto**: `scripts/eval-motor.ts`, `docs/onboarding-colaborador.md`,
      `docs/tarefas/`. ✅ *2026-07-02*
- [ ] **Decidir a estratégia de merge da branch** (69 commits à frente da main) — decisão do dono.
- [ ] 🟢 *Danilo:* cenários eval multi-turno csmed — confirmação de chamado ("sim, pode
      registrar" → action) e "preciso de uma pessoa pra cuidar do meu pai" (NÃO deve escalar).

> **Pronto quando:** backup restaurado num teste; derrubar o serviço de propósito notifica o
> celular em <15min; serviço em build de produção sobrevive a `git checkout` sem mudar
> comportamento; eval csmed sem fallback por timeout.

### 2ª quinzena de julho — Segurança mínima multi-tenant + guard de saúde
- [x] **Credencial por tenant**: `npm run operator:add` (cria/rotaciona com senha própria;
      csmed e prestacon JÁ rotacionados), seed fail-closed em produção e restrito aos tenants
      DEMO, rate-limit no `/login` (15/min). *(S2/R2)* ✅ *2026-07-02*
- [x] **Tirar csmed/prestacon da demo pública** — `DEMO_TENANT_SLUGS` explícita: registrar
      cliente novo não o publica na demo. *(R3)* ✅ *2026-07-02*
- [x] **Guard de saúde à prova**: plural por palavra + escape de regex nos triggers; 192/SAMU
      na `humanMessage` do csmed; alarme URGENTE (throttle próprio, 2 min) em handoff
      `sensitive_topic`. *(M4)* ✅ *2026-07-02*
- [x] **Webhook confiável fase 1**: `WebhookEvent` persistido ANTES do 200; dedup por wamid
      `@unique`; drain no POST + sweeper 60s; evento-veneno vira `failed` após 5 tentativas.
      *(C2)* ✅ *2026-07-02*
- [x] **Consertar `neverPromise`** (negação na mesma sentença libera "não fazemos diagnóstico";
      "não X, mas garanto Y" continua barrado) e **escapar regex** nos triggers. ✅ *2026-07-02*
- [ ] 🟢 *Danilo:* assertar `fellToFallback=false` por default no eval (com opt-out) + expandir
      `knowledge/csmed` com base na conversa com a mãe.

> **Pronto quando:** login da CS MED não abre nenhum outro tenant (teste cross-tenant manual);
> `/demo/chat` não lista tenants reais; "dores fortes no peito" escala deterministicamente com
> 192 na resposta; `kill` no meio do processamento não perde a mensagem.
>
> ✅ **Verificado ao vivo em 2026-07-02**: seed antiga rejeitada no csmed e senha nova logando;
> demo pública sem ocorrência de tenant real; evento pendente sobreviveu a restart e foi
> retomado pelo sweeper (motor real, 30s) com alarme de envio falho disparando no ntfy.

### 1ª quinzena de agosto — 🤝 Piloto CS MED acordado + caminho crítico da Meta
- [ ] **MARCO DE NEGÓCIO — reunião com a mãe do Danilo**: demo no simulador, confirmar a dor
      nº1, acordar piloto GRÁTIS com prazo (ex: 60 dias) e critério de sucesso combinado. Sem
      pressão — enquadrar como piloto institucional.
- [ ] **Iniciar HOJE o processo Meta** (leva dias a semanas — caminho crítico do calendário):
      verificação do negócio, número de produção, display name. Decidir: número sob a WABA da
      DGC ou WABA própria da CS MED. *(R1)*
- [ ] **Mitigação de áudio em horas**: auto-resposta "recebi seu áudio, por aqui só consigo ler
      texto" pra qualquer não-texto — nunca mais vácuo. *(M2 parcial)*
- [ ] **Provar `abrir_chamado` ponta a ponta no csmed**: conversa multi-turno real em que a
      confirmação gera `Ticket` no banco — é a metade do pitch nunca comprovada. *(M3)*
- [ ] `channel:'whatsapp'` correto na Conversation (1 linha) — separa uso real de demo.
- [ ] 🟢 *Danilo:* script CLI `tenant:add` + registro de número (`registerWhatsappNumber` já
      existe testada, só não tem chamador).

> **Pronto quando:** piloto aceito verbalmente com prazo e critério anotados; verificação
> submetida na Meta; registro de um chamado csmed nascendo no banco via conversa com
> confirmação; áudio recebe resposta.

### 2ª quinzena de agosto — 🚀 PILOTO NO AR
- [ ] **MARCO DE NEGÓCIO — número real da CS MED atendendo clientes de verdade** (plugado via
      script, sem SQL na mão).
- [ ] **Áudio de verdade**: webhook → download da mídia (Graph API) → faster-whisper → motor.
      *(M2 completo)*
- [ ] **Fila `/atendente` com atualização automática** (polling/revalidação) — escalação nova
      aparece sem F5.
- [ ] **Mensagem de 1ª interação**: aviso de atendimento com IA + tratamento de dados (mínimo
      LGPD no canal). *(S1 parcial)*
- [ ] **Operação assistida semana 1**: acompanhar TODAS as conversas diariamente; ciclo curto de
      ajuste em config/knowledge.
- [ ] 🟢 *Danilo:* cenários eval extraídos das conversas reais (anonimizados).

> **Pronto quando:** ≥10 conversas reais processadas; zero mensagem perdida (conferência
> messageId × banco); zero emergência clínica mal conduzida; humano responde escalação em
> <30min em horário comercial.

### Setembro — Piloto estável + papelada de cobrança
- [ ] Rodar o mês inteiro com ciclo semanal: conversa ruim → ajuste em config/knowledge.
- [ ] **DECISÃO: preço e modelo** (mensalidade flat pro cliente 1; faixa de conversas depois) —
      informado pelo volume real do piloto. *(P1)*
- [ ] **Contrato-modelo simples**: escopo, mensalidade, o que a IA faz/não faz, limitação de
      responsabilidade, anexo de tratamento de dados (operador LGPD). Revisão externa se der.
      *(P2)*
- [ ] **Política de privacidade de 1 página** + retenção definida + script de expurgo por idade.
      *(S1)*
- [ ] **Proposta comercial / doc de handoff** (2-3 páginas): o que responde, quando escala, o
      que NÃO faz, horário de suporte, o que acontece se cair.
- [ ] **Corrigir a métrica de autonomia** (contar `HandoffEvent`, não status) — o número-herói
      vai pra proposta e não pode mentir.
- [ ] 🟢🟡 *Danilo:* campo de expediente no TenantConfig + `humanMessage` fora de horário
      ("equipe retorna às 8h; emergência: 192").

> **Pronto quando:** 30 dias de piloto com ≥50 conversas reais e autonomia medida honestamente;
> contrato + política + proposta em PDF prontos pra assinar; preço decidido e escrito.

### Outubro — Motor comercializável (anthropic_api + custo conhecido)
- [ ] **Provider `anthropic_api`** (fim do refino grátis no claude_cli, conforme a estratégia da
      fase 2): `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`, mesma validação/fallback. Destrava
      ToS, hospedagem e latência. *(S3/P3, M1 estrutural)*
- [ ] **Medir custo real por conversa** na API paga por 2 semanas → validar a margem do preço de
      setembro ANTES da proposta.
- [ ] **Latência alvo <10s** — verificar no eval e nas conversas reais.
- [ ] **DECISÃO: hospedagem** — Pi endurecido vs VPS ~€5/mês (Hetzner CAX11 + Caddy +
      Litestream). Se VPS, migrar NESTE mês, com o piloto ainda grátis (erro de migração não
      queima cliente pagante).
- [ ] Backup/versionamento do config+knowledge dos tenants (cópia timestampada antes do
      `saveTenantConfig` sobrescrever).
- [ ] 🟢 *Danilo:* corrigir o playbook (promessa falsa do `no_knowledge_match`; Passo 7
      desatualizado) + task doc do tenant do cliente 2.

> **Pronto quando:** piloto 100% na anthropic_api por ≥2 semanas sem regressão no eval; custo
> por conversa documentado; latência média <10s; decisão de hospedagem executada.

### Novembro — 💰 Conversão CS MED + funil do cliente 2
- [ ] **MARCO DE NEGÓCIO — reunião de conversão**: métricas do piloto (conversas, autonomia,
      leads, zero incidente) + proposta com preço; assinar contrato.
- [ ] **DECISÃO: entidade emissora** (CNPJ da DGC vs MEI) e fluxo manual de NFS-e — B2B não
      formaliza recorrência sem NF, mesmo que a 1ª cobrança seja Pix.
- [ ] **Plano B ativo — prospecção do cliente 2 em paralelo** (contabilidade ou assistência
      técnica, conforme `verticais-alvo.md`): 10 contatos, 3 demos. Se a conversão CS MED travar
      pela relação familiar, o cliente 2 vira o alvo de dezembro.
- [ ] **Onboarding do cliente 2 preparado**: tenant via script, número via script, senha própria
      — provar que replicar não depende de commit.
- [ ] Definir SLA informal do contrato: horário de suporte, o que acontece quando cai, quem
      responde alarme.
- [ ] 🟢 *Danilo:* config + knowledge do tenant do cliente 2 — desta vez sem tocar em código.

> **Pronto quando:** contrato CS MED assinado com valor e data OU proposta formal entregue +
> cliente 2 com demo feita e proposta na mesa; tenant do cliente 2 criado sem nenhum commit.

### Dezembro — 🏁 META: 1ª mensalidade recebida
- [ ] **MARCO DE NEGÓCIO — o 1º pagamento na conta** (Pix + NFS-e emitida) — da CS MED
      convertida ou do cliente 2.
- [ ] Checklist pré-cobrança (abaixo) conferido item a item e arquivado como evidência.
- [ ] Rotina de operação paga: backup verificado semanalmente, alarme testado mensalmente,
      revisão de conversas 1×/semana, expurgo rodando.
- [ ] Retrospectiva do piloto → atualizar o playbook com o processo real (vira o roteiro do
      cliente 3).
- [ ] Pipeline 2027: cliente 2 em piloto (se CS MED pagou) ou 2 prospects em demo.
- [ ] 🟡 *Danilo:* melhorias da fila `/atendente` a partir do feedback do operador real.

---

## ✅ Checklist "posso mandar boleto?" (a régua final)

Antes da 1ª cobrança, TODOS marcados:

- [ ] Provider **anthropic_api em produção** (zero dependência da assinatura pessoal), custo por
      conversa medido e documentado
- [ ] **Preço por escrito, proposta aceita, contrato assinado** (escopo, mensalidade, o que a IA
      faz/não faz, limitação de responsabilidade)
- [ ] **LGPD mínima ativa**: aviso de IA + tratamento na 1ª interação, política de privacidade,
      retenção definida com expurgo funcionando
- [ ] **Backup diário com teste de restore documentado**; `DATABASE_URL` absoluto
- [ ] **Alarme + monitor externo armados**: queda, fallback, falha de envio e escalação de saúde
      notificam alguém em <15min
- [ ] **Build de produção** (não vite dev) com env fail-closed; deploy não é a working tree
- [ ] **Senha exclusiva por tenant** + rate-limit no login — credencial do cliente não abre
      outro tenant
- [ ] **Número de produção verificado na Meta** atendendo qualquer número, token System User
      confirmado via `debug_token`
- [ ] **Webhook com persistência antes do 200 + dedup por messageId** — não some em restart, não
      duplica em redelivery
- [ ] **Áudio tratado** (transcrição ligada ou, no mínimo, auto-resposta) — nunca vácuo
- [ ] **`abrir_chamado` provado ponta a ponta** no tenant do cliente (multi-turno com
      confirmação → Ticket no banco)
- [ ] **Demo pública sem acesso a tenants reais**
- [ ] **Guard de saúde verificado** (plurais, 192/SAMU, alarme em handoff sensível) — se o
      cliente for da vertical saúde
- [ ] **Piloto ≥30 dias com métricas honestas** (autonomia via `HandoffEvent`) apresentadas
      antes da proposta

## ⚠️ Riscos de verdade (e o antídoto)

1. **Verificação da Meta no caminho crítico** — leva dias a semanas. *Antídoto: submeter na 1ª
   quinzena de agosto, sem esperar o resto.*
2. **Relação familiar trava a conversão grátis→pago** — constrangimento de cobrar a mãe do
   colaborador. *Antídoto: o funil paralelo do cliente 2 em novembro; a meta de dezembro não
   pode ser refém de uma única conversa delicada.*
3. **Dono part-time é gargalo único** — 2-3 semanas de imprevisto derrubam um marco. *Antídoto:
   as tarefas 🟢 do Danilo andam em paralelo de verdade.*
4. **Pi doméstico durante o piloto** — queda de luz/disco antes do backup+alarme armados destrói
   a confiança na fase em que ela é construída. *Antídoto: julho-quinzena-1 vem ANTES do piloto.*
5. **Emergência clínica mal conduzida** — furo de plural, resposta sem 192, fila que ninguém vê
   à noite = risco reputacional/jurídico que encerra o piloto E a vertical. *Antídoto:
   julho-quinzena-2 + expediente em setembro.*
6. **Latência queima o piloto antes do motor bom chegar** — se 21-30s frustrar em agosto/
   setembro, antecipar a migração pra anthropic_api (a data de outubro não é sagrada).
7. **Custo por conversa conhecido só DEPOIS do preço decidido** — mitigar: estimar teto pela
   tabela de preço da API em setembro; validar em outubro; renegociar cedo se a margem não
   fechar.
8. **Merge da branch (69 commits) com produção na working tree** — um checkout errado muda o
   atendimento ao vivo. *Antídoto: C3 (build de produção) + estratégia de merge em julho.*
9. **Pi compartilhado com o cryptobot** (swap saturado) — pico de um derruba o outro no meio do
   piloto. *Antídoto: monitor externo + decisão de hospedagem em outubro.*
10. **Escopo-fantasma vendido como garantia** — `forbiddenTopics`, `requireConfirmation`,
    "fora da base escala automaticamente": ou implementa, ou remove da tela/playbook antes da
    proposta.

## 🧭 Decisões que só você pode tomar (agende com você mesmo)

| Quando | Decisão |
|---|---|
| Julho | Estratégia de merge da branch `feat/danilo-tenant-csmed` (merge integral vs promover a main) |
| 1ª quinz. agosto | Modelo WhatsApp: número sob a WABA da DGC vs WABA própria da CS MED |
| 1ª quinz. agosto | Enquadramento do piloto: duração (30/60/90d), critério de sucesso, quem opera a Central |
| Setembro | **Preço e modelo de cobrança** (flat vs faixa de conversas; desconto simbólico vs preço cheio pra CS MED) |
| Outubro | Hospedagem: Pi endurecido vs VPS ~€5/mês — e quando migrar |
| Outubro | Data de corte claude_cli → anthropic_api (manter outubro ou antecipar) |
| Novembro | Entidade emissora (CNPJ DGC vs MEI) + fluxo de NFS-e |
| Novembro | Vertical e canal de prospecção do cliente 2 |
| Novembro | SLA e suporte do serviço pago (o que é prometido em contrato) |

---

## 🔁 A regra continua a mesma

O [plano-de-voo.md](plano-de-voo.md) segue valendo: **uma caixinha por dia**. Este documento só
deixa claro *quais* caixinhas, *em que ordem* e *por quê* — pra que em dezembro tenha dinheiro
de mensalidade na conta e um produto que mereça.

*Gerado a partir da auditoria ultracode de 2026-07-02 (35 agentes, ~2,2M tokens; 20 bloqueios
confirmados por verificação adversarial, 3 rebaixados, 1 refutado). Resultado bruto:
`/tmp/.../tasks/resultado.json` da sessão.*
