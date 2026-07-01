# Plano de Genericização do Hermes

**De "motor configurável com amarras" a "produto multi-tenant vendável".**

Este documento lista as mudanças concretas de **código e arquitetura** necessárias para o Hermes deixar de ser um motor que *parece* genérico mas ainda carrega suposições de vertical, idioma e cliente coladas no código — e virar um produto que se configura para qualquer empresa, com isolamento de dados de verdade, auth por escritório e LGPD básico.

O motor já está ~85% genérico na arquitetura (`processIncomingMessage` é dirigido pelo `TenantConfig`, a IA propõe JSON e o balcão valida). O que falta são **amarrações pontuais** que impedem vender para o segundo, terceiro e enésimo cliente sem editar código.

---

## Como ler este plano

Cada mudança tem: **o quê**, **por quê**, **arquivos afetados**, **esforço** (P = até meio dia, M = 1–3 dias, G = mais de 3 dias) e **bloqueante para vender?** (se sem isso não dá para colocar um segundo cliente real em produção).

A ordem é por prioridade de venda: primeiro o que trava a operação multi-cliente real (isolamento, roteamento, auth, LGPD), depois o que trava a *replicação horizontal* (tirar suposições de vertical/idioma do motor), por fim o que é higiene de produto (versionamento, onboarding UI, RBAC).

---

## Bloco 1 — Isolamento de dados e roteamento (BLOQUEANTE: sem isso, dois clientes reais vazam um no outro)

| # | O quê | Por quê | Arquivos | Esforço | Bloqueante? |
|---|-------|---------|----------|---------|-------------|
| 1.1 | **Roteamento WhatsApp → tenant dinâmico via banco.** Substituir o parse da env `WHATSAPP_NUMBER_MAP` por uma tabela `WhatsappNumber { phoneNumberId @unique, tenantId }` no Prisma; `resolveTenantSlugByPhoneNumberId` vira query. | Hoje o mapa número→slug é uma **string de env** parseada em runtime (`app/lib/whatsapp.server.ts:93-101`). Cada cliente novo = editar env + redeploy. Em SaaS real cada tenant tem seu(s) número(s); sem tabela, não escala. | `app/lib/whatsapp.server.ts:93-101`, `prisma/schema.prisma`, `app/routes/webhook.whatsapp.tsx` | M | **Sim** |
| 1.2 | **Descoberta de tenants pelo banco, não por array hardcoded.** `INITIAL_TENANTS` (`app/lib/tenants.server.ts:8-12`) vira apenas *seed de dev*. O caminho de produção (`findTenantInput`, resolução em `conversation.server.ts`) deve consultar `db.tenant`, não a constante. | Hoje adicionar um cliente exige **code change + rebuild** porque a lista de 3 slugs (`dgc`, `assistencia-tecnica-demo`, `prestacon`) é hardcoded e a conversa rejeita slugs fora dela. Isso é o gargalo nº 1 da replicação. | `app/lib/tenants.server.ts:8-12,35-37`, `app/lib/conversation.server.ts` | M | **Sim** |
| 1.3 | **`tenantId` direto no model `Message`.** Adicionar `tenantId` a `Message` (hoje herda só via `conversationId → conversation.tenantId`), com índice `@@index([tenantId])`. | Qualquer query a `message` que esqueça de passar por `conversation` **vaza mensagem entre tenants** (`prisma/schema.prisma:58-68`). Defesa em profundidade: o isolamento não deve depender de um único join sempre correto. | `prisma/schema.prisma:58-68`, migration, pontos que criam Message | M | **Sim** |
| 1.4 | **Escopar `tenantId` em TODA query no `where`, não só validar depois de ler.** Auditar leituras/escritas de `Ticket`, `Lead`, `Conversation`, `Message` para incluir `tenantId` no filtro do Prisma. Exemplo: `Ticket.contactId` não é validado como pertencente ao tenant — só `Ticket.tenantId` é checado na aplicação (`app/routes/atendente.tsx:71`), depois de já ter lido o registro. | Validar posse *depois* de ler é vazamento latente: um bug de escopo entrega o dado antes do check. O filtro tem que estar no `where`. | `app/routes/atendente.tsx:30,49,71`, `app/lib/dossier.server.ts:131,147`, `app/lib/dashboard.server.ts:14` | M | **Sim** |
| 1.5 | **FK/constraint entre `contactId` e `tenantId`.** Garantir no schema (ou em validação determinística no balcão) que `Ticket.contactId`/`Lead` de um contato pertençam ao tenant. | `Ticket.contactId` não tem amarração ao tenant no schema (`prisma/schema.prisma:99-113`); só a app checa. Um chamado pode, em teoria, ser lido por outro tenant se a app errar o filtro. | `prisma/schema.prisma:99-113` | P | Não (mas alto valor) |

> **Nota sobre banco único.** Todos os tenants compartilham o mesmo SQLite. Isolamento por schema/database separado ou row-level security é o padrão SaaS maduro, mas é **G** e não bloqueia o primeiro punhado de clientes. Recomendação: manter SQLite único com `tenantId` disciplinado (1.3–1.5) para os primeiros clientes; planejar Postgres + isolamento por linha quando passar de ~10 tenants. Registrar como decisão consciente.

---

## Bloco 2 — Auth por tenant e LGPD básico (BLOQUEANTE: exigência legal + operação)

| # | O quê | Por quê | Arquivos | Esforço | Bloqueante? |
|---|-------|---------|----------|---------|-------------|
| 2.1 | **Múltiplos operadores por tenant.** Hoje o operador é *um por tenant*, com `username = slug` (`app/lib/operators.server.ts:71-87`). Desacoplar: `username` livre, `tenantId` continua na sessão; uma tela mínima de cadastro de operador (ou seed por env estruturado). | `requireOperator` já escopa tudo por `operator.tenantId` — a base está certa. Mas 1 login por escritório não serve a um escritório com 3 atendentes. É operação básica. | `app/lib/operators.server.ts:71-87`, `prisma/schema.prisma:29-40` | M | **Sim** |
| 2.2 | **Audit log de acesso a dados pessoais (LGPD).** Model `AuditLog { operatorId, tenantId, action, entity, entityId, at, ip }`. Registrar quem leu/editou dossiê, lead, ticket, config. | LGPD exige rastreio de acesso a dado pessoal (telefone, bairro, need do lead). Hoje **não há nenhum rastro** de quem fez o quê. Sem isso, não se vende para cliente que leva compliance a sério. | novo `app/lib/audit.server.ts`, `prisma/schema.prisma`, chamadas em `atendente.tsx`, `configuracoes.tsx` | M | **Sim** |
| 2.3 | **Auditoria + rate-limit no webhook.** Logar IP/timestamp/tenant de cada request no `webhook.whatsapp.tsx`; throttle por tenant. | Sem rate-limit por tenant, um cliente (ou um atacante no número dele) **bombardeia e degrada todos os outros** (banco e provider de IA compartilhados). Webhook também não tem nenhum log hoje. | `app/routes/webhook.whatsapp.tsx`, `app/lib/whatsapp.server.ts` | M | **Sim** |
| 2.4 | **Marcar campos sensíveis do `Lead` para retenção/masking.** Definir política de retenção e, no mínimo, mascarar telefone/bairro nos logs. Idealmente um flag por tenant. | `Lead` guarda telefone, bairro, need (dado pessoal) sem qualquer política de expurgo ou masking. LGPD pede minimização e prazo. | `prisma/schema.prisma:70-85`, `app/lib/lead.ts`, logging | M | Não (mas exigência legal — fazer cedo) |
| 2.5 | **Verificar posse antes de ler o dossiê por slug.** `getContactDossier` resolve o tenant por slug e confia que o slug vem do contexto certo; validar `operator.tenantId == tenant.id`. | Confiança implícita no slug é a mesma classe de bug do 1.4: um slug vindo de lugar errado entrega dossiê de outro escritório. | `app/lib/dossier.server.ts:131,147` | P | **Sim** |

---

## Bloco 3 — Tirar suposições de VERTICAL do motor (BLOQUEANTE para replicação: hoje "assistência técnica" está colado no código)

Este bloco é o coração do pedido: **o motor decide comportamento por `if slug === 'assistencia-tecnica-demo'` e por listas de termos de São Paulo/pt-BR hardcoded.** Isso impede vender para uma clínica, um pet shop, uma imobiliária sem editar `.ts`. A regra de ouro: *tudo que varia por vertical vira campo do `TenantConfig`; o código só lê o campo.*

| # | O quê | Por quê | Arquivos | Esforço | Bloqueante? |
|---|-------|---------|----------|---------|-------------|
| 3.1 | **Matar o `if tenantSlug === 'assistencia-tecnica-demo'`.** Substituir o ternário `isAssistencia` por um campo de config: `TenantConfig.nextStepPrompt?: string` (ou `askForLocationAndProduct?: bool`). O código lê o campo; se ausente, usa um default neutro. | `app/lib/response.ts:91` decide a resposta comparando com **um slug específico** (`isAssistencia`, usado no ternário da linha 98). Isso é a antítese de produto genérico: o motor "sabe" de um cliente. Cada vertical novo com fluxo próprio exigiria mais um `if`. | `app/lib/response.ts:34-38,91,98`, `app/lib/attendant/tenant-config.ts` | M | **Sim** |
| 3.2 | **Bairros canônicos → `TenantConfig`.** Mover `NEIGHBORHOODS` (lista fixa de bairros de SP, `app/lib/lead.ts:14-23`) para `TenantConfig.locations?: string[]`. Sem config, não detecta bairro (não inventa). | Lista de bairros de São Paulo hardcoded quebra para qualquer cliente de outra cidade — e é dado de localização, tipicamente por-tenant. | `app/lib/lead.ts:14-23,47-50`, `tenant-config.ts` | M | **Sim** |
| 3.3 | **Termos de urgência → `TenantConfig`.** `URGENCY_TERMS` (`app/lib/lead.ts:11`, pt-BR fixo) vira `escalationPolicy.urgencyTerms?: string[]` com um default global. | Urgência é sinal específico de vertical (assistência: "parou"; contabilidade: "prazo da Receita"). Fixo no código, não serve a todos. | `app/lib/lead.ts:11,42-45`, `tenant-config.ts` | P | Não (mas fácil e alto valor) |
| 3.4 | **Gatilhos de preço e de próximo passo → `TenantConfig` (são duas listas distintas, não uma).** No `response.ts` existem **dois mecanismos separados**: (a) `CLOSED_PRICE_TRIGGERS` (`response.ts:26` — `'preco fechado'`, `'valor final'`, `'quanto fica'`, `'fechar valor'`), que disparam a nota de "não fecho valor por aqui"; e (b) `NEXT_STEP_TRIGGERS` (`response.ts:13-24` — inclui `'orcamento'`, `'agendar'`, `'parou'`, e os termos de assistência técnica `'geladeira'`, `'maquina'`, `'ar-condicionado'`), que disparam a orientação de próximo passo. Migrar cada uma para seu destino de config: `guardrails.pricingTriggers?: string[]` e `escalationPolicy.nextStepTriggers?: string[]` (ou junto do `nextStepPrompt` do 3.1). **Não fundir as duas em `pricingTriggers`** — são gatilhos de mecanismos diferentes. | `'geladeira'`, `'ar-condicionado'` são termos de assistência técnica **colados no motor** (via `NEXT_STEP_TRIGGERS`). Um contador nunca dispara isso; um pet shop precisa de outros. E os gatilhos de *preço fechado* são um mecanismo à parte, que também varia por vertical. | `app/lib/response.ts:13-24,26,94-98`, `tenant-config.ts` | M | **Sim** |
| 3.5 | **`SENSITIVE_PHRASES` globais + por-tenant, de verdade.** O `decideHandoff` **já soma** `extraSensitiveTriggers` do config aos globais (`app/lib/handoff.ts:44-48`) — bom, e esse é o estado atual: o conjunto do tenant é **adicionado**, não substitui o global. Mas `SENSITIVE_PHRASES` (`handoff.ts:15`) e `REQUESTED_HUMAN_PHRASES` (`handoff.ts:7-13`) continuam **globais e em pt-BR**. Item futuro: permitir **sobrescrever/substituir** o conjunto global por idioma no config (hoje só dá para somar). | Um cliente em espanhol nunca escala com "humano"/"atendente". Os globais deveriam ser *default por idioma*, sobrescrevível — não constantes fixas. Hoje o tenant só consegue *acrescentar* gatilhos sensíveis, nunca trocar o conjunto base. | `app/lib/handoff.ts:7-13,15,40-48`, `tenant-config.ts` | M | Não (globais servem pt-BR por ora; somar já funciona) |
| 3.6 | **`FORBIDDEN_CLAIMS` global + `neverPromise` por tenant.** O validador já soma `guardrails.neverPromise` ao global — manter. Expor o global como default configurável por idioma. | `FORBIDDEN_CLAIMS` (`app/lib/attendant/validate.ts:10-16`) e a lista em `response.ts:11` são pt-BR fixas; um vertical em outra língua não tem coleira. | `app/lib/attendant/validate.ts:10-16`, `app/lib/response.ts:11` | P | Não |
| 3.7 | **Ativar `forbiddenTopics` e `maxDiscountPercent`.** Ambos existem no schema do `TenantConfig` (`tenant-config.ts:49-50`) mas **não são usados em lugar nenhum** e nem aparecem na UI. Ou implementar no validador/handoff, ou remover para não vender promessa falsa. | Campo de config que não faz nada é dívida e engana quem configura. Gap entre "capacidade declarada" e "execução". | `app/lib/attendant/tenant-config.ts:49-50`, `validate.ts`, `app/routes/configuracoes.tsx` | M | Não |

---

## Bloco 4 — Tirar suposições de IDIOMA e CANAL do motor (BLOQUEANTE só se vender fora do pt-BR/WhatsApp)

| # | O quê | Por quê | Arquivos | Esforço | Bloqueante? |
|---|-------|---------|----------|---------|-------------|
| 4.1 | **Idioma parametrizável.** Introduzir `TenantConfig.language` (default `pt-BR`) e injetá-lo nos 3 pontos que hoje forçam português no código: a `BASE_RULES` ("Responda em português…", `rules.ts:6`), o prompt de summary ("em português,", `summary.server.ts:23`) e o prompt do provider Claude CLI (`claude-cli.server.ts:40`). | O idioma está **hardcoded em 3 lugares críticos de produção** (não em config). Vender para um cliente que atende em espanhol/inglês exige refactor hoje. | `app/lib/attendant/rules.ts:6`, `app/lib/summary.server.ts:23`, `app/lib/attendant/providers/claude-cli.server.ts:40`, `tenant-config.ts` | M | Não (só se internacionalizar) |
| 4.2 | **Canal agnóstico nos prompts.** A regra "como numa conversa de WhatsApp" (`rules.ts:6`) e "atendendo um cliente no WhatsApp" (`claude-cli.server.ts:40`) devem virar "mensagem assíncrona" ou vir do config (`channel`). O model `Conversation.channel` já existe (`schema.prisma:45`) — usar. | O motor assume WhatsApp como canal único no prompt; se um dia entrar Instagram/web chat, o texto fica errado. Barato tornar neutro agora. | `app/lib/attendant/rules.ts:6`, `claude-cli.server.ts:40` | P | Não |
| 4.3 | **Stopwords por idioma.** As stopwords em pt-BR no RAG lexical (`retrieval.ts`) e no dedup de ticket (`ticket.ts`) são globais. Amarrar ao `language` do tenant. | RAG e dedup pioram em outro idioma com stopwords erradas. Consequência direta de 4.1. | `app/lib/retrieval.ts`, `app/lib/ticket.ts` | M | Não |
| 4.4 | **Gravar o canal real da conversa (não o default de demo).** Na criação de conversa nova, `db.conversation.create` grava **sempre** `channel: 'simulator'` (`conversation.server.ts:116`), ignorando o canal real que chega do webhook. Ou seja: **toda conversa nasce marcada `simulator`**, mesmo quando a origem é o WhatsApp. Corrigir para usar o canal real do `requestContext`/`input.channel`. Já o `contactId` **não** é o problema: `const contact = input.contactId ?? 'demo-user'` (`conversation.server.ts:105`) respeita o contactId real e só cai no default `demo-user` quando ele está ausente — fallback aceitável. | O bug real é o `channel` fixo em `'simulator'`: contamina a métrica de canal e qualquer lógica que dependa dele, marcando conversas de produção como se fossem simulação. O default de `contactId` é legítimo e não deve ser tratado como amarra. | `app/lib/conversation.server.ts:116` (e passar `channel` do `input`/`requestContext` até a criação) | P | Não (mas fácil — corrigir cedo) |

---

## Bloco 5 — Catálogo e capacidades por tenant (destrava novos verticais além de assistência/contabilidade)

| # | O quê | Por quê | Arquivos | Esforço | Bloqueante? |
|---|-------|---------|----------|---------|-------------|
| 5.1 | **Catálogo de tools deixar de ser `type` fechado.** `ToolName` é um enum TypeScript (`abrir_chamado \| consultar_chamados \| pedir_agendamento`, `tenant-config.ts:15`) espelhado em `KNOWN_TOOLS` na UI (`configuracoes.tsx:18-22`). Enquanto for `type`, adicionar tool = mudar tipo + testes. Avaliar catálogo data-driven ou pelo menos ampliar deliberadamente. | Os 3 clientes atuais compartilham **exatamente as mesmas 3 tools**. Um vertical que precise de tool própria (ex.: "pedir_orcamento", "consultar_status_entrega") exige code change. É a próxima amarração a doer na replicação. | `app/lib/attendant/tenant-config.ts:15`, `app/routes/configuracoes.tsx:18-22`, `validate.ts` | G | Não (mas o próximo teto) |
| 5.2 | **`objectives` enum → validado mas extensível.** Mesmo padrão: `TenantObjective` é enum fixo (`tenant-config.ts:8-13`). Documentar que é orientação (não fluxo) e, se virar métrica, permitir extensão. | Objetivo hoje é só orientação ao prompt, não é enforçado. Se o produto medir conversão por objetivo, o enum fechado limita. | `app/lib/attendant/tenant-config.ts:8-13`, `configuracoes.tsx:24-30` | M | Não |
| 5.3 | **`sourceDir` editável / derivado do slug.** `sourceDir` é fixo no JSON e a UI de `/configuracoes` o preserva sem permitir editar; `safeDefaultConfig` deriva `knowledge/${slug}` (`tenant-config.ts:195`). Padronizar em `knowledge/<slug>/` derivado do slug e tirar do config (ou expor na UI de onboarding). | Onboarding de vertical novo esbarra em `sourceDir` que só se edita no JSON/arquivo. Derivar do slug elimina o campo manual. | `app/lib/attendant/tenant-config.ts:39-40,195`, `configuracoes.tsx` | P | Não |
| 5.4 | **Isolamento de acesso à knowledge base em runtime.** `knowledge/<slug>/` é lido do disco a cada request sem checar que o slug pedido bate com o tenant do contexto. Garantir que o load só aceite o slug já resolvido/autorizado, e revisar permissões de SO. | Se a resolução de slug falhar, a IA de um tenant pode ser levada a ler a base de outro. Também sem cache: lento em produção com muitos docs. | `app/lib/knowledge.server.ts:28-69` | M | Não (mas revisar cedo) |

---

## Bloco 6 — Higiene de produto: versionamento, onboarding, rollback (destrava vender com confiança e operar em escala)

| # | O quê | Por quê | Arquivos | Esforço | Bloqueante? |
|---|-------|---------|----------|---------|-------------|
| 6.1 | **Versionamento/backup do `TenantConfig`.** `saveTenantConfig` **sobrescreve o JSON sem histórico** (`tenant-config.ts:172-183`). Guardar versão anterior (tabela de versões ou snapshot em disco) + rollback. | Um save inválido ou uma edição errada de config **corrompe o comportamento do cliente sem volta**. Para vender com SLA, precisa de rollback. | `app/lib/attendant/tenant-config.ts:172-183`, `configuracoes.tsx:99-100` | M | Não (mas quase — risco operacional alto) |
| 6.2 | **Fonte única de verdade: config no banco.** Hoje `TenantConfig` vive em arquivo (`config/tenants/<slug>.json`) e o resto no Prisma — duas fontes. Migrar o config para o banco (a própria doc do código diz "na Fase 4 vira banco — só `loadTenantConfig` muda"). | Arquivo no disco do servidor não versiona, não faz backup atômico, não escala horizontalmente (2 instâncias = 2 discos divergentes). Bloqueia deploy multi-instância. | `app/lib/attendant/tenant-config.ts:144-183`, migration | G | Não (bloqueia só ao escalar infra) |
| 6.3 | **Onboarding UI (wizard de novo cliente).** Fluxo: criar tenant → subir docs de knowledge → configurar tools/objetivos → mapear número WhatsApp → criar operador. Hoje é tudo manual (JSON + pasta + array + env + seed). | Cada cliente novo é um processo manual de 5 passos em lugares diferentes. Para *vender em volume*, onboarding tem que ser tela, não engenharia. Depende de 1.1, 1.2, 2.1. | novo `app/routes/onboarding.tsx`, `configuracoes.tsx` | G | Não |
| 6.4 | **Migração/upgrade de schema do `TenantConfig`.** Adicionar campo novo ao config hoje exige editar todos os JSONs à mão. Script de upgrade + versão do schema no config. | Toda mudança deste plano que adiciona campo (3.x, 4.x) multiplica trabalho manual por nº de tenants. Um migrador resolve de vez. | novo script em `scripts/`, `tenant-config.ts` | M | Não |
| 6.5 | **Factory de tenant para testes.** Testes hoje hardcodeam slugs (`prestacon`, `assistencia-tecnica-demo`). Uma factory (`makeTestTenant(overrides)`) evita que cada mudança de config quebre testes acoplados a clientes reais. | Testes acoplados a clientes de produção travam a evolução do config. Uma factory desacopla. | `app/lib/**/*.test.ts`, novo helper de teste | P | Não |
| 6.6 | **RBAC além de "admin do próprio tenant".** Hoje todo operador de um tenant vê tudo do tenant; sem papéis (ex.: atendente vs. gestor) nem operador multi-tenant. Modelar papéis quando um cliente pedir. | Escritório maior vai querer separar quem vê o dashboard de quem só atende a fila. Não bloqueia os primeiros clientes. | `prisma/schema.prisma`, `app/lib/auth.server.ts` | G | Não |

---

## Sequência recomendada (o caminho crítico para vender)

1. **Semana 1–2 — travar o vazamento e o roteamento (Bloco 1 + 2.5):** 1.1, 1.2, 1.3, 1.4, 2.5. Sem isso, um segundo cliente real é risco de vazamento de dado. É o piso inegociável.
2. **Semana 2–3 — auth e LGPD (Bloco 2):** 2.1, 2.2, 2.3. Múltiplos operadores, audit log, rate-limit. Piso legal e operacional.
3. **Semana 3–4 — desamarrar o vertical (Bloco 3):** 3.1 (matar o `if slug`), 3.2, 3.4 primeiro; 3.3/3.7 na sequência. É o que transforma "produto de assistência técnica" em "produto genérico" de fato.
4. **Depois, conforme a demanda:** Bloco 4 só se internacionalizar (com 4.4 como fix barato para fazer cedo); Bloco 5 quando um vertical pedir tool própria; Bloco 6 (6.1 e 6.3 primeiro) para vender com confiança e onboarding rápido.

---

## Definição de Pronto — "Produto Genérico Multi-Tenant"

O Hermes está pronto como produto genérico vendável quando **todas** as afirmações abaixo forem verdadeiras:

**Isolamento e roteamento**
- [ ] Nenhum dado de um tenant é alcançável por outro, mesmo com bug de aplicação: `tenantId` está no `where` de toda query e no model `Message`, não só validado após a leitura (1.3, 1.4).
- [ ] Adicionar um cliente **não requer rebuild**: tenants e mapeamento de número WhatsApp vêm do banco, não de `INITIAL_TENANTS` nem de `WHATSAPP_NUMBER_MAP` (1.1, 1.2).

**Auth e LGPD**
- [ ] Um escritório tem N operadores; cada um só vê a fila/dossiê/painel do seu tenant (2.1, e o `requireOperator` que já existe).
- [ ] Todo acesso a dado pessoal (dossiê, lead, ticket, edição de config) é registrado em audit log com operador, ação, timestamp e IP (2.2, 2.3).

**Zero suposição de vertical/idioma/cliente no código**
- [ ] `grep` por nomes de tenant no código de produção (`assistencia-tecnica-demo`, etc.) retorna **zero** ocorrências que alterem comportamento (3.1).
- [ ] Bairros, termos de urgência, gatilhos de preço fechado e gatilhos de próximo passo vêm do `TenantConfig`, não de constantes globais (3.2, 3.3, 3.4).
- [ ] O idioma é um campo do config (mesmo que só `pt-BR` por ora) — não há "português" hardcoded nas rules, no summary nem no prompt do provider (4.1). *(Requisito só se for internacionalizar; caso contrário, marcar como decisão consciente de manter pt-BR.)*
- [ ] Nenhum campo do `TenantConfig` é "decorativo": todo campo declarado (incl. `forbiddenTopics`, `maxDiscountPercent`) ou é executado no código, ou foi removido (3.7).

**Onboarding e operação**
- [ ] Colocar um cliente novo no ar é um **procedimento data-driven documentado** (config + knowledge + número + operador), sem editar `.ts` — idealmente por tela (6.3), no mínimo por script.
- [ ] Uma edição de config errada é **reversível**: há histórico/rollback do `TenantConfig` (6.1).

**Prova viva**
- [ ] **Assumindo 1.1 e 1.2 já concluídos** (tenants e números vindos do banco, não mais de `INITIAL_TENANTS` nem de `WHATSAPP_NUMBER_MAP`), existe **um quarto tenant de um vertical novo** (ex.: clínica, pet shop ou imobiliária) rodando **só com config + knowledge base + registro no banco** (tenant + número + operador) — **zero linha de `.ts` específica dele**. Este é o teste de aceitação final. *(Ressalva importante: no estado atual do código, sem 1.1 e 1.2 feitos, o quarto tenant ainda exigiria adicionar o slug a `INITIAL_TENANTS` e mapear o número em `WHATSAPP_NUMBER_MAP` — por isso a prova só é atingível depois desses dois itens.)*
