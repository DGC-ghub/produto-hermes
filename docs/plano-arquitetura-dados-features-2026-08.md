# Plano — Arquitetura de dados e próximas features do Hermes (funções gerais de mercado)

> Rascunho para leitura do Gabriel. Escrito de forma autônoma (sem perguntas), por pedido explícito, durante a madrugada de 2026-08-05. É **plano, não código** — segue a convenção do repo (doc antes de implementação, TDD quando for pra valer, migration Prisma só quando o modelo realmente precisar).

## 0. Achado que muda a leitura de tudo abaixo (leia isso primeiro)

Antes de propor qualquer coisa nova, fui conferir o estado real do repo (`feat/dominio-pronto`, schema, rotas, docs existentes) em vez de assumir o que a memória de sessões anteriores dizia. Achado importante:

**`docs/auditoria-saas-readiness.md` (2026-07-06) está desatualizada em pontos centrais.** Aquela auditoria (62 agentes, extremamente rigorosa) concluiu que faltavam, como bloqueadores de venda: conta de dono pagante, signup, verificação de e-mail, cobrança, provisionamento automático de tenant, UI de conexão de WhatsApp. **Hoje o schema já tem** `Account`, `Membership`, `Subscription`, `TenantConfigRecord` (TenantConfig migrado pro banco, exatamente como o comentário antigo previa), `KnowledgeDoc` (base de conhecimento também no banco), `AiSetup`/`AiSetupVersion`/`AiSetupJob`/`AiSetupEvent` (motor de onboarding assistido por IA), `ChannelSession` (Baileys) e `WhatsappNumber` com campos de credencial cifrada. **E existem rotas** `/signup`, `/verificar-email`, `/esqueci-senha`, `/redefinir-senha`, `/conectar-whatsapp`, `/canais`, `/conhecimento`, `/assinar`, `/preparar-ia`, `/testar-ia`.

Ou seja: entre 06/07 e hoje (05/08), boa parte dos marcos M1–M4 daquela auditoria (conta de dono, signup, provisionamento automático, config/knowledge no banco, canal WhatsApp — oficial e não-oficial — por tenant) parece ter sido **construída**. O histórico de commits recente (`git log`) mostra trabalho concentrado em "Setup de IA" (onboarding assistido, fila com lease/heartbeat/backoff) — compatível com essa leitura.

**Isso muda a pergunta.** Se a fundação self-service (M0–M4) já existe, a pergunta deixa de ser "como vendemos o primeiro cliente" e passa a ser exatamente a que você fez: **quais funções de produto — coisas que empresas de verdade usam no dia a dia — valem a pena entrar agora**, em cima de uma base que já aguenta onboarding sozinho.

**Recomendação prática, fora do escopo deste doc mas registrada:** antes de confiar 100% nisso, vale rodar uma auditoria fresca (mesmo estilo da de julho) focada só em "o que dos M1–M4 realmente funciona ponta a ponta hoje" — eu confirmei que os *modelos* e *rotas* existem, não testei os fluxos ao vivo. Trato esse doc como estratégico assumindo que a fundação está no rumo certo, mas essa validação é barata e vale a pena antes de apostar pesado em cima dela.

## 1. Onde este plano se encaixa no que já está em andamento

Já existe uma frente aberta, com plano próprio e execução em curso num worktree isolado: `docs/plano-consulta-chamados-e-conector-externo.md`, branch `feat/hermes-consulta-chamados-conector-externo`. Ela cobre exatamente o candidato "conector genérico pra sistema externo do cliente" (tool nova no catálogo da IA, arquitetura de pré-busca proativa, sem loop de tool-calling). **Este documento não duplica aquilo** — trata do que vem depois, e assume que aquela frente vai fechar e ser mergeada primeiro (é a próxima peça pequena e já madura).

Este plano também não repete o conteúdo de `docs/verticais-alvo.md` (ranking de nichos) nem de `docs/auditoria-saas-gaps.md`/`docs/auditoria-saas-readiness.md` (gaps de infra SaaS) — ele **assume os dois como lidos** e propõe a camada de cima: funcionalidades de produto que fazem o Hermes valer mais para o dono de negócio que já está pagando.

## 2. Princípios que não mudam (herdados de `docs/produto.md`)

Repito porque tudo abaixo tem que respeitar isto sem exceção:

- **"A IA propõe (JSON), o balcão valida e executa."** Toda feature nova que envolva a IA decidir algo (mudar estágio de CRM, sugerir departamento, disparar notificação) segue o mesmo padrão: guard-rail determinístico no código, nunca confiado ao prompt.
- **Anti-escopo intocável:** sem construtor visual de fluxo, sem disparo em massa/automação de grupo, sem virar ferramenta de marqueteiro. Qualquer feature de notificação/campanha tem que provar, na modelagem, que é estruturalmente 1:1 e amarrada a um evento de domínio real — não um "quase disparo em massa disfarçado".
- **Isolamento por `tenantId`** em toda query nova, sem exceção — é o invariante mais repetido no código hoje e não pode quebrar.
- **Um motor, N configs** (`TenantConfig`) — nada de branch por cliente no código.

## 3. Arquitetura de dados — estado atual (o que já existe, resumido)

Pra não repetir o schema inteiro (está em `prisma/schema.prisma`), o que importa pro que vem a seguir:

| Model | Já cobre | Não cobre ainda |
|---|---|---|
| `Tenant`, `Account`, `Membership` | identidade multi-tenant, dono vs operador | papel diferenciado por departamento/fila |
| `Operator` | atendente humano, login | departamento, disponibilidade, papel granular |
| `Conversation`, `Message`, `HandoffEvent` | histórico, escalação | fila **por departamento**; quem assumiu não é claro no que li — **confirmar antes de codar** se `Conversation`/`HandoffEvent` já guardam o operador que assumiu |
| `Lead` | `stage`, `urgency`, dados extraídos | funil/pipeline navegável (o dado existe, a tela não) |
| `Ticket` | chamado interno com dedup | — |
| `TenantConfigRecord` | config declarativa por tenant no banco | roteamento por departamento, regras de notificação |
| `KnowledgeDoc` | base RAG editável pela tela | — |
| `MessageTrace` | telemetria técnica (sem PII) | métricas de negócio por atendente/departamento |
| `AiSetup*` | onboarding assistido | — |
| `Subscription` | assinatura/cobrança | — |
| `WhatsappNumber`, `ChannelSession` | credencial por tenant, oficial + Baileys | envio proativo fora da janela de 24h (templates) |

**Achado técnico relevante para tudo que segue:** `AttendantAction` (em `app/lib/attendant/types.ts`) hoje é um tipo **mono-membro** — só existe `'abrir_chamado'`. Toda vez que uma feature nova quiser que a IA *proponha* uma ação de domínio (mover lead de estágio, sugerir departamento, marcar satisfação), isso passa por generalizar esse tipo pra uma union de verdade e estender `validateAction` no balcão. Melhor fazer isso **uma vez, de forma genérica**, do que ad hoc a cada feature — ver §6.

## 4. Catálogo de features candidatas — priorizado

Critério de prioridade: valor pra um dono de negócio real (não só "legal ter"), esforço de dado (schema novo vs reaproveitar o que existe), e risco de escorregar pro anti-escopo.

### Onda A — curto prazo, alto valor / esforço baixo-médio

#### A1. Fila multi-atendente por departamento
**Problema real:** hoje `/atendente` é fila única, priorizada, sem noção de "departamento" ou "quem está disponível". Assim que um tenant tem mais de 1 atendente (o normal em qualquer negócio com mais de um funcionário), a fila vira uma bagunça de "quem pega o quê".

**Dado necessário (novo):**
```
model Department {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  slug      String
  createdAt DateTime @default(now())
  @@unique([tenantId, slug])
  @@index([tenantId])
}
```
+ tabela de junção `OperatorDepartment` (um atendente pode estar em mais de um departamento) — mais simples e honesto do que um FK único em `Operator`, porque na prática atendentes cobrem mais de uma fila.
+ `Conversation.departmentId?` (nullable — conversa sem departamento cai na fila geral, comportamento de hoje preservado).

**Decisão de arquitetura a validar com você antes de planejar em detalhe:** quem decide o departamento de uma conversa?
- (a) Regra determinística por palavra-chave/objective no `TenantConfig` (ex.: tenant configura "financeiro" ↔ termos ["boleto","pagamento","fatura"]) — **sem IA decidindo**, 100% no balcão.
- (b) A IA propõe um `suggestedDepartment` no JSON de saída, validado contra a lista de departamentos configurados do tenant (rejeita se não bater) — mais flexível, mas é uma ação nova da IA (entra na generalização de `AttendantAction`, §6).

Minha recomendação, dado o padrão já estabelecido no resto do produto (pré-busca proativa em vez de a IA decidir coisa crítica): começar por **(a)**, determinístico, e só evoluir pra (b) se (a) se mostrar insuficiente na prática. Evita dependência de acurácia de IA num componente de roteamento operacional.

**Esforço:** médio. Toca `Department`, `OperatorDepartment`, `Conversation`, a query de `getHandoffQueue` em `dossier.server.ts`, e a tela `/atendente` (filtro por departamento) + `/configuracoes` (cadastro de departamentos e regras).

#### A2. Métricas por atendente/departamento no dashboard
**Problema real:** `/dashboard` hoje é agregado por tenant inteiro. Assim que existe mais de um atendente (ou departamento via A1), o dono quer saber "quem está respondendo rápido, quem está com fila parada".

**Dado necessário:** provavelmente **nenhum model novo** — é um read-model sobre dados que já existem (`Conversation`, `HandoffEvent`, `Message`), agrupado por operador/departamento. Resistir à tentação de criar uma tabela de agregação (`DailyMetricsSnapshot` ou parecido) até o volume de dado realmente deixar a query lenta — isso é exatamente o tipo de abstração prematura que o CLAUDE.md deste repo pede pra evitar. Se/quando a query agregada ficar cara, aí sim vira um job noturno que popula uma tabela de snapshot.

**Depende de A1** ter dado ao menos o `departmentId`; métricas por atendente sozinhas nem precisam de A1 (só precisam confirmar que dá pra saber, hoje, qual operador assumiu cada conversa — item a verificar no código antes de planejar em detalhe).

**Esforço:** baixo-médio, majoritariamente leitura/agregação.

#### A3. Funil de CRM leve sobre o `Lead.stage` que já existe (fatia inicial do F5)
**Achado que baixa muito o custo desta feature:** o dado central de um funil de CRM — `Lead.stage` — **já existe no schema**. `docs/produto.md` já descreve a intenção certa: "pipeline movido pela IA, corrigível pelo humano". O que falta não é modelo de dado, é **tela**: uma visão Kanban-lite (ou lista agrupada por estágio) sobre os `Lead`s existentes, com transição manual pelo humano no balcão.

**Por que priorizar isso na frente de Campanhas (F6):** F6 depende estruturalmente de F7 (WhatsApp oficial com templates, pra poder mandar mensagem fora da janela de 24h) — F5-lite não depende de nada disso. É a feature "de graça" mais valiosa do roadmap hoje.

**Esforço:** baixo (tela + eventualmente uma ação de mudança manual de estágio no balcão — não precisa nem tocar a IA na v1). Se depois a IA passar a propor mudança de estágio automaticamente, isso entra na generalização de `AttendantAction` do §6.

#### A4. Horário de funcionamento aplicado de verdade
**Problema real:** `TenantConfig.businessProfile.workingHours` já existe como campo declarativo, mas (pelo que vi) é descritivo — não há confirmação de que o balcão aplica isso deterministicamente (ex.: anexar aviso de "fora do horário, resposta amanhã" fora do expediente, sem depender da IA lembrar disso no prompt). É uma feature pequena com alto retorno de credibilidade — "meu atendente nunca erra o horário" é o tipo de coisa que empresa nota.

**Esforço:** baixo. Zero schema novo (dado já existe), só lógica determinística no balcão.

### Onda B — médio prazo

#### B1. Pesquisa de satisfação pós-atendimento (CSAT de 1 pergunta)
Ao fechar uma conversa (ou N horas depois), uma mensagem simples "de 0 a 5, como foi o atendimento?" — 1:1, amarrada à conversa que acabou de fechar, nunca campanha. Modelo pequeno:
```
model SatisfactionResponse {
  id             String   @id @default(cuid())
  tenantId       String
  conversationId String   @unique
  score          Int
  createdAt      DateTime @default(now())
  @@index([tenantId])
}
```
**Depende do mesmo pré-requisito técnico de A/B de notificação (envio proativo/template)** se for enviado como mensagem nova fora da janela de 24h; se for perguntado dentro da própria conversa antes de fechar, não depende de nada novo — mais simples de começar por aí.

#### B2. Etiquetas/tags de conversa
Organização simples (`Tag` + `ConversationTag` many-to-many por tenant) — baixo esforço, ajuda o dono a filtrar a fila quando ela cresce (principalmente combinado com A1).

#### B3. Relatórios exportáveis (CSV) de leads/tickets
Self-service em vez de pedir query SQL toda vez que o dono quer analisar fora do produto. Zero schema novo — é uma rota que serializa consultas já existentes.

#### B4. Notificação operacional 1:1 orientada a evento (candidato 4 do benchmark)
**Aqui é onde preciso ser mais cauteloso — é o candidato com maior risco real de escorregar pro anti-escopo**, e por isso trato como desenho, não como algo pra iniciar agora.

**Pré-requisito duro que não existe hoje:** envio proativo de mensagem fora da janela de atendimento de 24h da API oficial exige **template pré-aprovado pela Meta** (WhatsApp Business Platform). A auditoria de julho já apontava isso como gap (`mina_confianca`, não bloqueia venda, mas bloqueia *esta feature específica*); confirmei por grep que não há nenhum uso de `template` no código hoje. Ou seja: **B4 está estruturalmente bloqueada até existir suporte a template de mensagem** (parte do que o roadmap chama de F7).

**Desenho de dado, pra quando o pré-requisito existir** (não implementar agora):
```
model NotificationRule {
  id           String   @id @default(cuid())
  tenantId     String
  triggerType  String   // 'ticket_status_change' | 'appointment_reminder' | ...
  templateName String   // nome do template aprovado na Meta
  enabled      Boolean  @default(true)
  @@index([tenantId])
}

model ScheduledNotification {
  id            String   @id @default(cuid())
  tenantId      String
  contactId     String
  ruleId        String
  sourceRecordId String  // id do Ticket/Lead/etc. que originou — nunca nasce sem uma origem
  scheduledFor  DateTime
  status        String   // pending | sent | failed
  sentAt        DateTime?
  @@index([tenantId, status, scheduledFor])
}
```
**Guard-rails estruturais que têm que estar no código, não em política/prompt**, exatamente para não virar disparo em massa disfarçado:
1. `ScheduledNotification` **só nasce a partir de um evento de domínio real** (mudança de status de um `Ticket` específico, por exemplo) — nunca de uma lista/segmento de contatos. Isso é o que separa estruturalmente "notificação operacional" de "campanha": a primeira sempre tem exatamente 1 `sourceRecordId` que já pertence àquele contato.
2. Idempotência por `(ruleId, sourceRecordId)` — nunca duas notificações pro mesmo evento.
3. Sem endpoint/rota que aceite uma lista de `contactId`s como entrada — se algum dia alguém propuser isso, é o sinal de que virou campanha e tem que ser recusado/redirecionado pra F6 com aprovação humana explícita.

### Onda C — estrutural, esforço grande, alto payoff

#### C1. Agendamento real (integração de calendário)
`docs/verticais-alvo.md` já deixou isso muito claro: o "Arquétipo Agenda" inteiro (clínicas, salão, pet, escola, psicologia — 6 dos 12 nichos ranqueados) está travado hoje porque `pedir_agendamento` só registra intenção e escala pro humano marcar de verdade. Isso é a maior alavanca de mercado do catálogo inteiro, mas é o item mais caro: integração real com agenda (Google Calendar, ou uma agenda própria no produto) é um projeto por si só, não uma tarefa.

**Não estou planejando isso em detalhe aqui** — é grande demais pra entrar nesta rodada, mas registro como o item de maior ROI de mercado depois que a Onda A estiver rodando, porque desbloqueia metade do ranking de verticais de uma vez.

#### C2. Campanhas com aprovação humana (F6)
Só depois de F7 (templates) e das guard-rails de limite/opt-out/log estarem desenhadas — e, por princípio deste produto, **nunca** disparo automático sem aprovação humana explícita por envio (ou por lote pré-aprovado com teto rígido). Não detalhar agora; é o item mais distante e mais sensível ao anti-escopo do catálogo inteiro.

## 5. "Funções gerais do mercado" — a pergunta que você fez

Sua frase foi "trazer funções gerais do mercado que geralmente as empresas precisam". Batendo isso contra `docs/verticais-alvo.md` (que já ranqueia 12 nichos reais), o padrão que emerge é: **quase toda empresa pequena/média que atende por WhatsApp precisa dos mesmos 6-8 blocos**, independente do nicho:

1. Triagem/FAQ (já existe — RAG)
2. Abrir/consultar chamado (já existe)
3. Qualificar lead (já existe)
4. **Funil/CRM leve** (A3 — dado já existe, falta tela)
5. **Fila organizada por equipe** (A1 — inexistente hoje, e todo negócio com >1 funcionário sente isso)
6. **Métricas de atendimento** (A2 — inexistente, todo dono quer saber "como estamos indo")
7. **Agendamento de verdade** (C1 — a maior lacuna real, mas cara)
8. **Notificação operacional pontual** (B4 — desejável, mas hoje bloqueada por pré-requisito técnico)

Ou seja: a Onda A deste plano **é** a resposta operacional à sua pergunta — são exatamente os blocos que aparecem repetidos em Blip/Botpress/Zenvia/Octadesk etc. (o benchmark original) e que fazem falta em qualquer vertical do ranking, não só numa específica.

## 6. Fundação técnica recomendada antes da Onda A: generalizar `AttendantAction`

Hoje `AttendantAction` é mono-tipo (`'abrir_chamado'`). A1 (se for pro caminho "IA sugere departamento"), A3 (se a IA vier a propor mudança de estágio) e B4 eventualmente todas batem na mesma parede: a IA precisa propor mais de um tipo de ação, e o balcão precisa validar cada tipo com sua própria regra.

Recomendo fazer essa generalização **uma vez, de forma mínima e correta**, antes de empilhar features que dependem dela — em vez de cada feature reinventar um jeito diferente de estender o tipo. Isso vira um pequeno plano técnico próprio (tipo union real + `validateAction` por tipo), documentado quando a Onda A for de fato priorizada — não estou detalhando aqui pra não misturar "arquitetura de suporte" com "feature de produto" no mesmo documento.

## 7. Ordem de ataque recomendada

1. **Fechar o que já está em execução** (conector externo + `consultar_chamados`, branch já aberta) — não empilhar trabalho novo em cima de um branch em SDD.
2. **A4 (horário de funcionamento determinístico)** — menor esforço de todo o catálogo, sem schema novo, ganho de credibilidade imediato.
3. **A3 (funil CRM leve sobre `Lead.stage`)** — maior valor por esforço de todo o catálogo (dado já existe).
4. **A1 (fila por departamento) + A2 (métricas)** juntas, porque uma alimenta a outra — mas primeiro validar com você a decisão de arquitetura do §A1 (regra determinística vs IA propõe, validado).
5. Reavaliar depois: B1–B3 (satisfação, tags, export) como polimento incremental; C1 (agendamento real) como a próxima grande aposta estrutural, quando fizer sentido investir num projeto do tamanho dele; B4/C2 só quando o pré-requisito de template/F7 existir.

Nenhum item acima está implementado. Este documento é só o plano — meu entendimento do que faz sentido e por quê, para você decidir a ordem e o corte real quando acordar.
