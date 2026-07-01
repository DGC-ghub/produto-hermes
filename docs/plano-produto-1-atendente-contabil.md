# Plano — Produto #1: Atendente Contábil no WhatsApp

> **Cunha de entrada.** Empacotar o motor do Hermes como um atendente de WhatsApp
> para escritório contábil. Reusa quase tudo que já existe; o trabalho é fechar a
> distância entre *demo que funciona* e *cliente real pagando*.
>
> **Cliente-âncora:** Prestacon Contabilidade (já tem `config/tenants/prestacon.json`
> e `knowledge/prestacon/`).
>
> Ordem geral dos produtos: **#1 Atendente** → #2 Coletor de documentos → #3 Leitor de doc fiscal.
> Só passamos pro #2 quando o #1 estiver de pé com um cliente real.

---

## Etapa 0 — Baseline honesto (o que JÁ existe)

Não recomeçar nada disto. Serve de chão para as próximas etapas.

- ✅ Motor plugável (`app/lib/attendant/`) com provider por env (`mock` | `claude_cli`).
- ✅ Saída da IA **sempre validada** antes de usar; fallback escala pra humano.
- ✅ `TenantConfig` da Prestacon (perfil, objetivos, tools, guardrails, escalação).
- ✅ Base de conhecimento inicial (`knowledge/prestacon/`: faq, serviços, prazos, tom…).
- ✅ RAG lexical (`retrieval.ts`) + base (`knowledge.server.ts`).
- ✅ `abrir_chamado` ponta a ponta (proposta da IA → validação → persistência) + dedup (`ticket.ts`).
- ✅ Tela `/atendente` (dossiê + fila de handoff), `/dashboard`, `/configuracoes`.
- ✅ Gate de operador (`requireOperator`) + login.
- ✅ Webhook do WhatsApp (`app/routes/webhook.whatsapp.tsx`).

**Gap real pra virar produto:** base de conhecimento boa da Prestacon, cérebro real
(sair do `mock`), `consultar_chamados` fechado, WhatsApp oficial no ar, e o mínimo de
operação (LGPD + cobrança).

---

## Etapa 1 — Base de conhecimento da Prestacon "de verdade"

**Objetivo:** a qualidade do atendente é limitada pela base. Lixo entra, lixo sai.

- [ ] Sentar com a Prestacon (ou usar material existente) e levantar as **20–30 perguntas
      mais repetidas** que caem no WhatsApp deles hoje.
- [ ] Reescrever/expandir `knowledge/prestacon/*.md` cobrindo: serviços + preços (faixa,
      sem prometer valor fechado), prazos das obrigações (DAS/Simples, folha, etc.),
      política de agendamento, o que é FAQ vs. o que **sempre** escala.
- [ ] Revisar `guardrails` e `escalationPolicy` no `prestacon.json` com base no que apareceu.
- [ ] Ajustar `extraRules` pra casos reais (ex.: "cliente pergunta imposto de terceiro → recusar").

**Pronto quando:** rodando o simulador (`/demo` ou `ATTENDANT_PROVIDER=claude_cli`), o
atendente responde bem as 20–30 perguntas-âncora e escala corretamente o que é sensível.

---

## Etapa 2 — Cérebro real (sair do `mock`)

**Objetivo:** respostas humanas de verdade, não roteiro fixo. (Ver memória: Fase 2 —
refinar no `claude_cli` local antes de virar pra API paga.)

- [ ] Rodar com `ATTENDANT_PROVIDER=claude_cli` e medir qualidade nas perguntas-âncora.
- [ ] Criar um **conjunto de avaliação** (arquivo com pares pergunta→resposta esperada /
      comportamento esperado) e um script simples que roda o motor contra ele.
      *(Já há `scripts/eval-motor.ts` e `vitest.eval.config.ts` em progresso — aproveitar.)*
- [ ] Afinar o prompt do provider (`providers/claude-cli.server.ts`) até passar no eval.
- [ ] Definir gatilho de troca pra `anthropic_api` só quando qualidade + custo justificarem.

**Pronto quando:** o eval passa num limiar combinado (ex.: ≥ 90% das âncoras OK) e as
falhas restantes escalam pra humano em vez de inventar resposta.

---

## Etapa 3 — Chamados de ponta a ponta

**Objetivo:** o atendente não só abre chamado — o escritório **consulta e resolve**.

- [ ] Implementar `consultar_chamados` de verdade (hoje está declarado na config; conferir
      se responde com os chamados do contato).
- [ ] Garantir que a fila em `/atendente` mostra chamado aberto → em andamento → resolvido.
- [ ] Cliente consegue perguntar "e o meu chamado?" e receber status pelo WhatsApp.

**Pronto quando:** um chamado nasce numa conversa, aparece no painel, o operador resolve,
e o cliente consegue consultar o status pela conversa.

---

## Etapa 4 — WhatsApp oficial (piloto real) ⭐ marco

**Objetivo:** sair do simulador e atender um número real da Prestacon.

- [ ] Fechar o setup da API oficial da Meta (ver `docs/whatsapp-setup*.md`): número,
      aprovação, templates iniciais.
- [ ] Ligar o `webhook.whatsapp.tsx` no número real; testar recebe/envia ponta a ponta.
- [ ] Rodar em **modo sombra** primeiro: IA sugere, humano aprova o envio (reduz risco).
- [ ] Depois liberar resposta automática só pro que é FAQ de baixo risco; resto escala.

**Pronto quando:** uma pessoa real manda mensagem pro WhatsApp da Prestacon e recebe
resposta útil do Hermes, com escalação funcionando.

**Riscos:** custo por conversa + aprovação Meta; atalho não-oficial = ban (não serve).
Infra: piloto pode rodar na Pi; produto pago vai pra VPS (uptime/segurança/escala).

---

## Etapa 5 — Operação mínima pra cobrar

**Objetivo:** o que falta pra ser um produto vendável, não um experimento.

- [ ] **LGPD:** aviso de tratamento de dados, retenção de conversa, política básica.
- [ ] **Multi-tenant/auth:** isolar dados por escritório (ver pendência de auth multi-tenant).
- [ ] **Deploy em VPS** com uptime e backup (a Pi não sustenta produto pago).
- [ ] **Cobrança:** definir modelo (mensalidade + faixa de conversas) e como faturar.
- [ ] Documento de handoff pro cliente: como configurar, o que a IA faz e o que não faz.

**Pronto quando:** dá pra colocar um segundo escritório sem mexer no código — só criando
`config/tenants/<novo>.json` + `knowledge/<novo>/` — e faturar por ele.

---

## Definição de sucesso do Produto #1

Prestacon usando o atendente no WhatsApp real, reduzindo o volume que cai no humano,
com um caminho claro pra plugar o **2º escritório** só por config. A partir daí, seguimos
pro **Produto #2 (Coletor de documentos)**.

---

## Isto NÃO é um produto só da Prestacon

Decisão de produto: o Hermes é uma **plataforma genérica multi-tenant** — configura-se
pra qualquer empresa e a Prestacon é apenas o 1º cliente. A documentação de replicação
(gerada por auditoria do código real) vive em três docs irmãos:

- **`docs/verticais-alvo.md`** — quais ramos encaixam, ranqueados, e a ordem de ataque
  (contabilidade → assistência técnica/oficina → condomínio → depois clínicas/salão/pet).
- **`docs/playbook-replicacao-vertical.md`** — o manual repetível pra pôr um novo cliente
  no ar (config + knowledge + número + operador), marcando o que é "só config" vs "exige código".
- **`docs/plano-genericizacao-multi-tenant.md`** — as mudanças de código pra tirar as amarras
  (matar o `if slug === 'assistencia-tecnica-demo'`, tenants/números vindos do banco em vez de
  hardcoded, isolamento de dados por `tenantId`, auth por tenant, LGPD).

> A Etapa 5 deste plano (operação pra cobrar) é executada seguindo o
> `plano-genericizacao-multi-tenant.md` — não reinventar.
