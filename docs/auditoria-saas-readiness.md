<!-- Gerado por auditoria multi-agente (62 agentes, ~1,78M tokens) em 2026-07-06. -->
<!-- Lente: o que falta pra vender o Hermes como SaaS self-service com seguranca. -->
<!-- Gaps detalhados com evidencia: auditoria-saas-gaps.md -->

# Hermes — do piloto artesanal ao SaaS self-service: o checklist por marcos

## Onde o Hermes está

O motor está sólido e é o ativo real: a IA propõe JSON, o balcão valida e executa (a IA nunca toca o banco), o isolamento de dados por `tenantId` está no `WHERE` de toda query, o webhook é fail-closed com fila persistida e dedup por `wamid`, os guard-rails de saúde são determinísticos no código, ~228 testes passam e há backup diário e build de produção. **Mas nada do que faz um SaaS "self-service" existe.** Confirmei no schema e nas rotas: não há conta de dono pagante (só `Operator` = atendente criado por CLI), não há signup, não há cobrança (zero dependência de gateway, zero model de assinatura), o provisionamento de tenant é 100% manual e depende de **escrever arquivos JSON no working tree do Pi** (`config/tenants/<slug>.json` + `knowledge/<slug>/`), o envio de WhatsApp usa **um token global** (o segundo cliente pagante não consegue enviar pelo próprio número), e o motor roda na **assinatura Claude PESSOAL do dono** via CLI (sem custo unitário, e revender viola o ToS). A distância real até "um estranho paga e usa sozinho" não é polimento — são **quatro sistemas que não existem** (identidade+conta, cobrança, provisionamento automático, credencial de canal por tenant) mais uma camada de conformidade/segurança (LGPD, rate-limit na superfície pública, ciclo de vida de assinatura). É um trabalho de **meses**, não de semanas, e a ordem importa mais que a velocidade.

Uma clareza que muda tudo: **você não precisa do canal não-oficial (Baileys) para vender.** O WhatsApp OFICIAL (Cloud API) já funciona ponta a ponta. O caminho mais curto até a primeira mensalidade é `conta → cobrança → provisionamento → credencial oficial por tenant`. Baileys, topologia de sockets persistentes e tráfego pago vêm **depois** de o funil converter sozinho.

## Mapa de gaps por área

Ordenado do mais crítico ao menos. Só os gaps confirmados no código. `bloqueia_venda` = impede a primeira mensalidade; `mina_confianca` = quebra a promessa/confiabilidade; `nice_to_have` = higiene.

### Área 1 — Conta, signup e cobrança (a espinha dorsal que falta)
- **Sem conta de DONO pagante nem papel owner/operator** — bloqueia_venda — semanas — `prisma/schema.prisma` só tem `Operator` (username+passwordHash+tenantId, linhas 46-57); grep por `Account|Owner|Subscription|Plan|Membership|email|role` no schema = zero (o único `role` é `Message.role`).
- **Sem rota de signup/cadastro** — bloqueia_venda — semanas — `app/routes.ts:3-12` (8 rotas, nenhuma `/signup`); toda conta nasce por CLI (`scripts/operator-add.ts`, `scripts/tenant-add.ts`).
- **Zero cobrança: nenhum gateway, model ou webhook de assinatura** — bloqueia_venda — semanas — `package.json` sem stripe/mercadopago/asaas; `Tenant` sem planId/status/trialEndsAt; toda "assinatura" no código é HMAC do webhook Meta.
- **Sem verificação de e-mail nem recuperação de senha** — bloqueia_venda — dias — grep `email|verif|smtp|nodemailer|reset|recuper` em `app/`/`prisma/` = zero lógica; a única "recuperação" é rotação manual via `scripts/operator-add.ts:47`.
- **Sem ciclo de vida de tenant (ativo/suspenso/trial) — cartão recusado não corta o serviço** — mina_confianca — dias — `Tenant` sem `status`; `whatsapp-queue.server.ts:78` chama `processIncomingMessage` sem checar assinatura; `requireOperator` (`auth.server.ts:72`) só valida sessão.
- **Login sem defesa CSRF (cookie `sameSite:'lax'`)** — mina_confianca — dias — `auth.server.ts:24`; grep `csrf|sec-fetch|origin` = zero; actions de `configuracoes.tsx`/`login.tsx` sem checagem de origem.
- **Sessão stateless de 8h não consulta o banco — não há revogação em tempo real** — mina_confianca — dias — `auth.server.ts:50-65` (`getOperator` só lê cookie) e `:27` (maxAge 8h); nenhum model `Session`.

### Área 2 — Credencial de WhatsApp por tenant (canal oficial multi-tenant)
- **Envio usa UM token global — 2º cliente não consegue enviar pelo próprio número** — bloqueia_venda — dias — `whatsapp.server.ts:177` (`process.env.WHATSAPP_ACCESS_TOKEN`); `WhatsappNumber` (schema:30-41) só tem `phoneNumberId`+`label`, sem credencial.
- **App Secret do inbound também é global** — bloqueia_venda — dias — `whatsapp.server.ts:45`; um App Secret não valida a assinatura de apps Meta de clientes distintos.
- **Sem UI para o dono plugar o próprio WhatsApp + sem Meta Embedded Signup** — bloqueia_venda — semanas — `configuracoes.tsx` não tem nenhum campo de número/token/canal; grep `embedded.?signup|oauth` = zero.
- **Sem envio proativo / janela de 24h + operador não tem envio manual no painel** — mina_confianca — dias — únicos callers de `sendWhatsAppMessage` são o drain da fila (`whatsapp-queue.server.ts:68,90`); `atendente.tsx` não tem form de resposta; grep `template` = zero.

### Área 3 — Motor: legalidade, custo e latência (margem)
- **Sem provider `anthropic_api`: motor roda na assinatura Claude PESSOAL (ToS proíbe revender)** — bloqueia_venda — dias — `attendant/index.ts:24-30` só ramifica `claude_cli|mock`; `claude-cli.server.ts:75` faz `spawn('claude')` na conta logada; `@anthropic-ai/sdk` não está no `package.json`.
- **Custo por conversa é DESCONHECIDO: uso de tokens é descartado** — mina_confianca — dias — `claude-cli.server.ts:77` (`--output-format text`); nenhum model de usage/custo no schema; sem medição não há como precificar com margem.
- **Latência 21,7s média / 30,7s pior caso; caminho web é síncrono** — mina_confianca — dias — `eval-report.md:19`; `demo.chat.tsx:136` (`await processIncomingMessage` no action).
- **Timeout default (30s) < pior caso medido (30,7s) → cai no fallback genérico** — nice_to_have — horas — `claude-cli.server.ts:8` (`?? 30000`) vs `.env.example:25` (45000).
- **Throughput serial: fila processa 1 LLM por vez, 1 subprocesso por mensagem** — mina_confianca — semanas — `whatsapp-queue.server.ts:154-167` (`for...of` com `await`); sem semáforo/pool. (Sobrevive com 1 cliente; teto rígido sob tráfego concorrente.)

### Área 4 — LGPD e superfície pública sob tráfego pago
- **Zero LGPD para dado de saúde: sem aviso de IA, consentimento, retenção ou expurgo** — bloqueia_venda — semanas — `handoff.ts:23` (LGPD é só trigger de roteamento); `Message` sem retenção; sem rota `/privacidade`; sem consentimento na 1ª mensagem em `conversation.server.ts`.
- **`/demo/chat` público escreve no banco e roda LLM+Whisper SEM rate-limit** — bloqueia_venda — dias — `demo.chat.tsx:100-149` (action público sem `checkRate`); `.env` real usa `claude_cli`, então cada mensagem anônima faz `spawn` do Claude — bomba de custo + DoS na aterrissagem do tráfego pago.
- **Demo pública vaza conversas entre visitantes anônimos** — mina_confianca — horas — `conversation.server.ts:107` (`contactId ?? 'demo-user'` fixo); `demo.chat.tsx` loader lista conversas do tenant sem auth.
- **Superfície servida direto pelo processo do Pi, sem WAF/proxy/TLS na borda** — mina_confianca — dias — `server.js` termina TLS no processo com cert self-signed; sem nginx/Caddy no repo; `rate-limit.ts` assume localhost.
- **Landing não converte: CTA leva a `/login` (beco sem saída), sem preço nem prova** — mina_confianca — dias — `home.tsx:92,152` (`Link to="/login"`); `home.tsx:150` promete "Sem cartão pra testar" mas o funil não entrega trial.

### Área 5 — Provisionamento e config em arquivo (trava a replicação)
- **`TenantConfig` vive em `config/tenants/<slug>.json` no working tree** — bloqueia_venda — semanas — `tenant-config.ts:152-163` (`readFileSync`, throw se falta) e `:180-191` (`writeFileSync`); comentário `:150` "na Fase 4 vira banco". Signup HTTP não consegue provisionar sem escrever arquivo no host.
- **Knowledge também é filesystem** — bloqueia_venda — semanas — `knowledge.server.ts:33` (`readdir(cwd/knowledge/<slug>)`).
- **Não existe `provisionTenant()` transacional idempotente** — bloqueia_venda — dias — grep `provisionTenant` = vazio; só `ensureTenant` (`tenants.server.ts:27`) que faz upsert do row.
- **Base de conhecimento só editável por arquivo — a própria tela admite "edite os arquivos por enquanto"** — bloqueia_venda — dias — `configuracoes.tsx:198`; `knowledge.server.ts` é read-only, nenhuma action grava `.md`.

### Área 6 — Operação, confiabilidade e release
- **Backup só no mesmo disco (`/dev/sda1`), sem cópia off-site** — mina_confianca — horas — `scripts/backup-db.sh:9`; crontab sem rclone/rsync/scp; falha de disco perde banco E backups.
- **Sem endpoint `/health` e monitor externo em DOWN/pausado** — mina_confianca — horas — `app/routes.ts` sem `/health`; `alarm.server.ts` só cobre fallback do motor e envio.
- **Deploy manual em 4 passos sem rollback; log mostra crash-loop de build ausente** — mina_confianca — dias — `hermes.log` (17× "Cannot find module .../build/server/index.js"); `deploy/README.md:22-31`; sem logrotate.
- **Produção roda de branch local (`feat/danilo-tenant-csmed`) não-pushada; `main` é snapshot de junho SEM o motor; sem CI** — mina_confianca — dias — `git rev-list main..HEAD` = 104 commits; `main:app/lib/attendant/validate.ts` não existe; `.github/workflows/` ausente. **Risco de perda total: o produto só existe no disco deste Pi.**

### Área 7 — Dívida de config e telas (replicação/confiança)
- **Extração de lead com bairros/urgência de SP hardcoded roda pra TODO tenant** — mina_confianca — dias — `lead.ts:11,14-23`; chamado sem gate em `conversation.server.ts:175`. Grava lead FALSO (bairro/urgência) na UI e no prompt de tenants fora do nicho.
- **Config exposta na tela (`forbiddenTopics`, `maxDiscountPercent`, `maxPriority`, `objectives`) não é aplicada por guard nenhum** — mina_confianca — dias — os 4 campos só têm parse+UI; ausentes de `validate.ts`/`handoff.ts`. Contradiz o pitch "guard-rails determinísticos".
- **Dono não gerencia a própria equipe pela tela** — mina_confianca — dias — operador só nasce por CLI; `AppShell.tsx` sem "Equipe".
- **Zero teste nas rotas que o self-service exercita (action de `configuracoes`, webhook)** — mina_confianca — dias — nenhum `*.test.ts` sob `*route*`; `configuracoes.tsx:45-108` faz preservação não-trivial de config sem roundtrip test.
- **`response.ts` é motor morto com gatilhos de vertical (geladeira/máquina) — engana quem lê** — nice_to_have — horas — nada importa `composeAssistantResponse`.
- **Modelo LLM é global (um `CLAUDE_MODEL` pra todos)** — nice_to_have — dias — `claude-cli.server.ts:7`; sem plano, não há de onde rotear.

---

## Os marcos — em ordem

Cada marco fecha um bloco de gaps e **só está pronto quando o teste passa**. A ordem é por dependência e por "o que destrava vender mais cedo". Os três primeiros (M0–M2) são pré-requisitos que não geram receita mas sustentam tudo. M3–M5 são a máquina de vender. M6–M7 são conformidade e blindagem antes de abrir a torneira. M8+ é escala/canal extra/tráfego — **só depois** de o funil converter sozinho com um cliente real.

> Convenção dos testes: onde digo "cenário ponta-a-ponta", faça-o num tenant de teste descartável (nunca `csmed`/`prestacon`) com cartão de teste do gateway. Todo marco deve manter `npm run typecheck && npm test && npm run lint` verdes — isso é piso, não critério.

---

### M0 — Rede de segurança do código (antes de mexer em qualquer coisa)
**Objetivo:** o produto deixa de existir só no disco deste Pi; toda mudança passa por CI; deploy tem rollback.
**Fecha os gaps:** Área 6 (branch local não-pushada, sem CI, deploy sem rollback), parte do backup off-site.
**Pronto quando:** (1) o branch com os 104 commits está no remoto; (2) existe `.github/workflows` (ou runner local) rodando `typecheck+test+lint` que **falha o merge** se algo quebra; (3) deploy publica num diretório versionado e troca um symlink `current` atômico; (4) backup roda um passo off-site cifrado e um restore de verdade foi executado.
**Como testar:**
```bash
# 1. o código está fora do Pi (não deve retornar vazio):
git branch -r --contains HEAD
# 2. CI barra código quebrado: abrir um PR que remove uma linha de um teste → o check fica vermelho
# 3. rollback: fazer deploy, quebrar o build de propósito, re-apontar o symlink 'current' pro release anterior → app volta em <30s
# 4. restore real: subir o serviço a partir do backup off-site num diretório limpo e ver /login responder
```

---

### M1 — Conta de dono + identidade (o sujeito a quem se vende)
**Objetivo:** existe uma entidade "dono pagante" separada do atendente, com papel, e a sessão carrega quem é dono vs operador.
**Fecha os gaps:** Área 1 (sem conta de dono, sem papel owner/operator); prepara a base de M2 e M4.
**Pronto quando:** (1) `Account`/`Owner` no schema com `email` único + `passwordHash` + relação ao `Tenant`; (2) `Membership`/`role` (owner|operator) — `Operator` migra pra isso; (3) `OperatorSession` passa a carregar `accountId + role`; (4) telas de admin (`configuracoes`, futura billing) exigem `role=owner`.
**Como testar:**
```bash
npx prisma migrate dev && npx prisma generate   # o CLAUDE.md avisa: rodar generate senão o model chega undefined
npm test                                        # + testes novos de auth com role
```
Cenário: criar um `Account` dono e um `Operator` do mesmo tenant; logar como operador e tentar abrir `/configuracoes` → **403/redirect**; logar como dono → **abre**. Um dono do tenant A não enxerga nada do tenant B (o isolamento por `tenantId` já existe — provar que continua).

---

### M2 — Signup público + verificação de e-mail + provisionamento automático
**Objetivo:** um estranho cria a conta pela web, verifica o e-mail, e um tenant **funcional** sobe sozinho — sem ninguém rodar comando.
**Fecha os gaps:** Área 1 (signup, verificação de e-mail, recuperação de senha); Área 5 (config e knowledge saem do arquivo para o banco; `provisionTenant()` transacional; CRUD de knowledge na tela).
**Por que aqui:** este é o marco mais pesado e o coração da virada. Sem tirar `TenantConfig` e knowledge do filesystem, o signup HTTP não consegue provisionar (hoje `tenant:add` imprime "copie o JSON à mão"). O comentário `tenant-config.ts:150` já antecipa "na Fase 4 vira banco — só esta função muda".
**Pronto quando:** (1) rota `/signup` (loader+action) cria `Account` fail-closed e dispara verificação de e-mail; (2) `TenantConfig` e `KnowledgeDoc` migrados para models Prisma por `tenantId`, `parseTenantConfig` mantido como validador; (3) `provisionTenant({slug,name,ownerEmail})` idempotente cria Tenant + config default seguro (`safeDefaultConfig`) + owner numa transação; (4) o dono edita perfil, guard-rails **e documentos de conhecimento** pela tela (`writeKnowledgeDoc` validado por `SAFE_SOURCE`); (5) `/recuperar-senha` e `/verificar-email` funcionam; (6) verificação de e-mail é pré-requisito para ativar uso (contém trial-farming).
**Como testar:**
```
Cenário ponta-a-ponta (sem tocar o shell do servidor):
1. Abrir /signup num navegador anônimo, cadastrar owner+empresa "teste-ltda"
2. NÃO clicar no link de e-mail ainda → tentar usar → bloqueado
3. Clicar no link de verificação → conta ativa
4. No painel, colar 2 parágrafos de conhecimento e definir tom
5. Mandar uma pergunta no simulador → a IA responde CITANDO o texto colado
6. Conferir no banco: existem Tenant + Account + TenantConfig + KnowledgeDoc — e ZERO arquivo novo foi escrito em config/tenants/ ou knowledge/
```
O passo 6 é o que prova que o provisionamento é self-service de verdade.

---

### M3 — Cobrança e ciclo de vida da assinatura (o "S" de SaaS pago)
**Objetivo:** o estranho **paga** uma mensalidade, e o pagamento controla o acesso automaticamente.
**Fecha os gaps:** Área 1 (zero cobrança, ciclo de vida de tenant); depende de M1+M2.
**Pronto quando:** (1) gateway escolhido e integrado (checkout hospedado); (2) model `Subscription` (provider, providerSubId, status, planId, currentPeriodEnd) ligado ao `Account`/`Tenant`; (3) webhook do gateway **fail-closed, idempotente por event-id, assinado** — espelhando o rigor do webhook da Meta; (4) `status` (trialing|active|past_due|suspended) sincronizado pelo webhook; (5) **gate determinístico** de "assinatura ativa" antes de `processIncomingMessage` (`whatsapp-queue.server.ts:78`) e no `requireOperator`; (6) política de suspensão com grace period.
**Como testar:**
```
1. Signup → checkout com cartão de teste do gateway → assinar → status vira 'active' no banco
2. Simular cartão recusado (evento past_due do gateway) → após grace period, mandar mensagem no canal → o bot NÃO processa (gate corta), e o dono vê aviso de pendência ao logar
3. Reativar pagamento → status volta a 'active' → bot volta a responder
4. Reenviar o mesmo webhook-event 2× → efeito aplicado uma vez só (idempotência)
5. Enviar webhook com assinatura inválida → rejeitado (fail-closed)
```

**⚠️ Decisão do dono antes de M3 (bloqueia o marco):** Pix manual vs gateway automático (ver seção final). O marco assume gateway com webhook; se for Pix manual, o critério (3)/(4) muda e o self-service fica capenga.

---

### M4 — WhatsApp OFICIAL por tenant (o cliente pluga o próprio número)
**Objetivo:** cada cliente pagante conecta o próprio WhatsApp Business e envia pelo próprio número — sem o dono editar `.env`.
**Fecha os gaps:** Área 2 inteira (token global, App Secret global, sem UI de conexão, sem Embedded Signup).
**Por que aqui e não antes:** com M1–M3 você já pode cobrar; mas do **2º cliente em diante** ninguém envia porque o token é global. Este marco destrava o multi-tenant real do canal oficial. (Baileys fica para M8 — não é pré-requisito de vender.)
**Pronto quando:** (1) credencial da Meta por tenant (accessToken **cifrado em repouso** + wabaId + phoneNumberId) em `WhatsappNumber` ou tabela de segredos; (2) `sendWhatsAppMessage` resolve o token pelo `phoneNumberId` do tenant, **não** do env; (3) a validação de assinatura inbound resolve o App Secret por número; (4) tela "Conectar WhatsApp" com Meta Embedded Signup (OAuth) — o dono conecta o próprio WABA; (5) o token nunca aparece em log.
**Como testar:**
```
1. Dois tenants de teste, cada um conecta um número Meta diferente pela tela
2. Cliente escreve pro número do tenant A → resposta chega pelo número do tenant A
3. Cliente escreve pro número do tenant B → resposta chega pelo número do tenant B
   (hoje isso falha: ambos usariam o mesmo token global)
4. grep no log durante o teste: o access token NÃO aparece
5. Desconectar o WABA do tenant A pela tela → envios do A param, os do B seguem
```

---

### M5 — Provider `anthropic_api` + custo unitário medido (margem legal)
**Objetivo:** o motor roda em API faturável da empresa (não na conta pessoal do dono), e você sabe quanto custa cada conversa.
**Fecha os gaps:** Área 3 (sem `anthropic_api` = ToS; custo desconhecido; latência síncrona; timeout curto).
**Por que aqui:** você **não pode** faturar estranhos rodando na assinatura Claude pessoal via CLI — é violação de ToS e escala linearmente por signup. E sem custo por conversa não dá pra precificar a mensalidade de M3 com margem conhecida. Pode ir em paralelo a M4.
**Pronto quando:** (1) `app/lib/attendant/providers/anthropic-api.server.ts` implementa `AttendantProvider` via `@anthropic-ai/sdk`, plugado em `resolveProvider()` como `ATTENDANT_PROVIDER='anthropic_api'`; (2) `claude_cli` fica só para dev/eval; (3) `response.usage` (input/output/cache tokens) é lido e persistido por mensagem+tenant (novo `UsageEvent` ou campos em `Message`); (4) relatório de custo por conversa/tenant/mês; (5) timeout com folga sobre o p99 real re-medido; (6) latência re-medida (a API corta o overhead de spawn do CLI).
**Como testar:**
```bash
ATTENDANT_PROVIDER=anthropic_api npm run eval:motor   # roda o banco de provas na API real
# Critérios observáveis no relatório:
# - responde sem spawn de 'claude' (checar: nenhum processo claude nasce durante a run)
# - cada cenário registra input_tokens/output_tokens e um custo em R$/US$
# - latência média cai vs os 21,7s do claude_cli (medir e comparar com eval-report.md:19)
# - custo/conversa somado × volume estimado < preço da mensalidade (a margem fecha)
```
O número de custo/conversa é o que valida (ou refuta) o preço que você vai cobrar. Sem ele, M3 precifica às cegas.

---

### M6 — LGPD mínima + guard-rails honestos (abrir cadastro com saúde sem se expor)
**Objetivo:** com dado de paciente real entrando, existe base legal, consentimento registrado, retenção definida e direito do titular — e nenhum controle na tela mente.
**Fecha os gaps:** Área 4 (zero LGPD); Área 7 (config exposta sem enforcement; lead SP hardcoded).
**Por que aqui:** o vertical CS MED é saúde (plantão/home care). Abrir cadastro público sem isto expõe o controlador à ANPD assim que um estranho plugar pacientes. Não bloqueia o encanamento, mas bloqueia o **lançamento responsável**.
**Pronto quando:** (1) aviso automático de IA + finalidade + base legal na 1ª mensagem de todo contato novo em `processIncomingMessage`, com `consentInformedAt`; (2) Política de Privacidade + Termos (rota pública) linkadas no signup e no rodapé, com DPO nomeado; (3) retenção definida (ex.: 12-24m) + job de expurgo/anonimização de `Message`/`Lead`/`HandoffEvent`; (4) rota de titular (exportar/apagar por `contactId`); (5) para cada campo de config exposto na tela (`forbiddenTopics`, `maxDiscountPercent`, `maxPriority`, `objectives`): **ou** implementar o guard determinístico **ou** remover da UI — nunca mostrar controle que o código ignora; (6) bairros/urgência de lead migram para `TenantConfig.leadHints` (sem hints → não detecta bairro), com teste provando que um tenant sem hints não extrai bairro nenhum.
**Como testar:**
```
1. Novo contato manda 1ª mensagem → recebe o aviso de IA/finalidade ANTES de qualquer outra coisa; consentInformedAt gravado
2. Abrir /privacidade e /termos publicamente (sem login) → carregam, com DPO e contato
3. Rodar o job de expurgo com data forçada → mensagens acima da retenção somem/anonimizam
4. Chamar a rota de titular pra um contactId → exporta o histórico; apagar → some
5. Marcar forbiddenTopics=["preço de concorrente"] num tenant → a IA se recusa/escala nesse tópico (guard dispara), OU o campo não está mais na tela
6. Tenant de saúde sem leadHints processa "vila nova, parou" → NÃO grava bairro/urgência (teste automatizado verde)
```

---

### M7 — Blindagem da superfície pública (antes de mandar tráfego)
**Objetivo:** a porta por onde o tráfego (e os bots) entram não é uma bomba de custo nem um vetor de DoS/vazamento.
**Fecha os gaps:** Área 4 (`/demo/chat` sem rate-limit; vaza conversas entre visitantes; sem WAF/proxy na borda); Área 1 (CSRF); Área 6 (`/health` + monitor).
**Pronto quando:** (1) rate-limit por IP no action de `/demo/chat` **antes** de tocar LLM/Whisper + captcha/Turnstile; (2) a demo força `ATTENDANT_PROVIDER=mock` (não precisa do cérebro caro) e teto de N áudios/janela; (3) cada sessão de demo isolada por cookie (`contactId` por sessão, loader só mostra a própria conversa); (4) defesa CSRF (token double-submit ou Origin/Sec-Fetch estrito) em todas as actions autenticadas — **obrigatório antes de billing** de M3 se M3 vier antes na prática; (5) reverse-proxy real (nginx/Caddy) com TLS gerenciado, `client_max_body_size`, timeouts e rate-limit por IP na borda; (6) rota `/health` (SELECT 1 → 200) + monitor externo apontado pra ela num domínio com cert válido (consertar o UptimeRobot em DOWN e abrir o path no funnel).
**Como testar:**
```
1. Disparar 100 POSTs no /demo/chat em 10s → após N, respostas 429 (rate-limit segura); nenhum spawn de 'claude' (demo em mock)
2. Dois navegadores anônimos diferentes no /demo/chat → um NÃO vê a conversa do outro
3. curl -I https://<dominio-publico>/health → 200; derrubar o processo → monitor externo alarma em minutos
4. Tentar um POST cross-site forjado na action de configuracoes → rejeitado (CSRF)
5. Enviar corpo com Content-Length mentiroso gigante → o proxy corta antes de estourar RAM
```

---

### M8 — Canal NÃO-oficial (Baileys) como onboarding rápido *(opcional, pós-primeira venda)*
**Objetivo:** um segundo canal de conexão por QR code, para onboardar clientes que não querem passar pela burocracia da Meta.
**Fecha os gaps:** Área 2/canais (sem abstração de canal, roteamento preso a `phoneNumberId`, topologia stateless não comporta socket persistente, sem persistência de sessão).
**Por que por último (e opcional):** o SaaS **vende e opera 100% no canal oficial** (M4). Baileys é um ADD que exige refactor multi-arquivo (fila, schema, resolução de tenant) + uma topologia de processo nova (socket persistente que o `Restart=always/RestartSec=5` do systemd hoje derrubaria). E os próprios docs do projeto o tratavam como risco de ban. **Regra de produto:** nunca o único canal de um tenant de saúde crítico.
**Pronto quando:** (1) interface `Channel` mínima (`parseInbound`/`sendText`) com Meta extraído como `MetaCloudChannel`; (2) `InboundMessage` generalizado (`channelId`/`externalKey` em vez de `phoneNumberId`); (3) coluna `channel` + `channelAccountId` no `WebhookEvent`, dedup composto por `(channel, messageId)`; (4) model `ChannelSession` (authState **cifrado**) e adaptador de auth-state do Baileys; (5) processo/serviço dedicado (`hermes-channels`) para os sockets, desacoplado dos deploys do app, com reconexão/backoff, teto de sessões pela RAM do Pi e healthcheck por sessão; (6) rota `/canais` com QR + status; (7) healthcheck que ao detectar ban alarma o operador e marca o canal indisponível.
**Como testar:**
```
1. No painel, /canais mostra QR → parear um WhatsApp de teste → status 'conectado'
2. Mandar mensagem por esse número → roteia pro tenant certo (via channel+channelAccountId, não phoneNumberId) → IA responde
3. Matar o processo hermes-channels e subir de novo → a sessão reconecta sozinha (não pede QR de novo)
4. Simular desconexão/ban → o operador recebe alarme e a tela marca o canal como indisponível
5. Deploy do app web (restart do hermes.service) → a sessão Baileys NÃO cai junto
```

---

### M9 — Ligar o tráfego pago *(só depois de M3–M7 provados com ao menos 1 cliente real pagando)*
**Objetivo:** gastar em anúncios só quando o funil `anúncio → landing → signup → pagamento → uso` converte **sozinho**, e cada real gasto é medível.
**Fecha os gaps:** Área 4 (landing não converte: CTA pra `/login`, sem preço, prova fictícia).
**Pronto quando:** (1) CTA primário aponta pra `/signup`; (2) seção de preços/planos real; (3) prova real (depoimento do 1º cliente CS MED/Prestacon ou número verificável do banco de provas) no lugar do `ChatPreview` fictício; (4) evento de conversão instrumentado (custo por cadastro medível); (5) M5 confirmou que a margem cobre o custo de LLM sob volume.
**Como testar:**
```
1. Um estranho de verdade (não você) recebe o link, entra pela landing, cadastra, paga e manda a 1ª mensagem — SEM você tocar em nada
2. O dashboard mostra: cliques → cadastros → pagamentos, com custo por cadastro
3. Rodar por uma semana com orçamento pequeno → CAC < valor da mensalidade × meses de retenção esperados
```
Só escale o orçamento depois que o passo 1 acontecer sem intervenção sua.

---

## O que NÃO fazer agora

- **Não pagar tráfego (M9) antes de M2+M3+M7.** Anúncio que joga na landing atual cai num CTA `/login` sem saída (`home.tsx:92`), e a copy "Sem cartão pra testar" promete um trial que não existe. Você paga por cliques que não têm como virar cliente — e cada bot que bate no `/demo/chat` sem rate-limit queima LLM/Whisper de graça.
- **Não construir Baileys (M8) antes de vender no canal oficial (M4).** É o item mais caro (refactor de fila+schema+resolver + topologia de socket nova) e não é pré-requisito de nenhuma venda. Fazê-lo cedo é semanas gastas antes de existir um cliente pagando.
- **Não migrar do Pi para VPS antes de ter cliente (parte de M0/decisões).** A pressão de RAM que parecia urgente foi refutada ao vivo (o swap é zram, não thrash de disco). O Pi aguenta 1–2 clientes. Migre quando o **gatilho** disparar (ex.: 3º cliente pagante OU fila passando de X), não por ansiedade.
- **Não perseguir concorrência/pool de workers (throughput serial) antes de haver concorrência real.** O drain serial sobrevive com 1 cliente; o próprio código diz "com um cliente isso sobrevive". O fix estrutural (API sem subprocesso) já vem de graça em M5.
- **Não implementar roteamento de modelo por plano nem multi-modelo** antes de existirem planos pagos (M3). Um `CLAUDE_MODEL` global basta enquanto você precifica o plano acima do custo do default.
- **Não escrever mais telas de "conta do dono" ricas** (consumo detalhado, gráficos) antes de M2+M3 — o dado de status/assinatura nem existe pra renderizar. Um checklist de onboarding simples resolve o essencial.
- **Não deletar `response.ts` no meio de um marco crítico** — é higiene (nice_to_have); faça numa faxina, não gastando foco de um marco que destrava venda.

## Decisões que só o dono toma

Estas bifurcações mudam o desenho dos marcos. Decida-as **antes** do marco correspondente.

1. **Gateway de cobrança: Pix manual vs assinatura automática (Stripe/Mercado Pago/Asaas).** — *Bloqueia M3.* Pix manual é rápido de começar mas não é self-service (alguém confere o comprovante e ativa à mão) e o critério de "corte automático por inadimplência" cai. Assinatura automática com webhook é o que fecha o "estranho paga sozinho", mas exige a integração idempotente/assinada. O plano assume o segundo. Se for Pix, aceite que M3 fica semi-manual.

2. **Número NÃO-oficial (Baileys) em base de saúde: sim ou não.** — *Define se M8 existe e com que regra.* Baileys onboarda rápido mas tem risco de ban silencioso; num tenant de saúde crítico (plantão), um ban deixa emergência sem resposta. Recomendação embutida: se sim, **nunca** como canal único de tenant de saúde, com healthcheck+failover e aceite de ToS no cadastro. Você pode decidir simplesmente **não fazer M8** e vender só no oficial — é uma escolha legítima e mais segura.

3. **Hospedagem: Pi endurecido vs VPS.** — *Afeta M0/M7 e o gatilho de migração.* O Pi doméstico serve o piloto, mas para SaaS pago com SLA a superfície pública quer TLS gerenciado + proxy + postura de servidor. Decida o **gatilho** (nº de clientes ou profundidade de fila) que dispara a migração, para não migrar cedo (desperdício) nem tarde (incidente).

4. **Trial grátis vs cobrar cheio de cara.** — *Afeta M2/M3.* Trial reduz atrito de cadastro mas abre trial-farming e bomba de custo de LLM por contas falsas — por isso a verificação de e-mail (M2) e o rate-limit (M7) são pré-requisitos se houver trial. Cobrar na hora reduz abuso mas corta topo de funil. Se trial: o cérebro caro (`anthropic_api`) só liga **após** e-mail verificado.

5. **Nível de conformidade LGPD no lançamento (M6): mínimo viável vs assessoria jurídica.** — Como o vertical é saúde (dado sensível), a exposição é real. Decida se o M6 mínimo (aviso+consentimento+retenção+direito do titular+DPO) basta para lançar, ou se quer um parecer jurídico antes de abrir cadastro público com pacientes reais. O código entrega os ganchos; a política e o DPO são decisão sua.

6. **Provedor de e-mail transacional (M2).** — Verificação de e-mail e reset de senha exigem um provedor (Resend/SES/Postmark/etc.). Escolha antes de M2 — é dependência dura do signup público.

---

*Notas de rastreio para o dono: todas as evidências acima foram verificadas nos arquivos reais em `/home/pi/projects/produto-hermes` nesta sessão. Os pontos load-bearing confirmados diretamente: `prisma/schema.prisma` (9 models, nenhum de conta/cobrança), `app/routes.ts` (8 rotas, sem signup/billing), `app/lib/whatsapp.server.ts:177` (token global) e `:45` (App Secret global), `app/lib/attendant/index.ts:24-30` (sem `anthropic_api`), `app/lib/attendant/tenant-config.ts:152-191` (config em arquivo, comentário "na Fase 4 vira banco" em `:150`), `scripts/tenant-add.ts:34-38` (onboarding manual), `app/lib/auth.server.ts:24,50-65` (cookie lax, sessão stateless), `app/routes/demo.chat.tsx:100-149` (action público sem rate-limit).*
