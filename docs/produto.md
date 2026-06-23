# Hermes — Spec de Produto

> Documento mestre da visão: o **o quê** e o **porquê**. O **como** detalhado vive nos
> planos de fase (`docs/plano-*.md`). Nome de trabalho: "Hermes" (ver "Nome e marca").

## Em uma frase

A IA que **opera** o atendimento de WhatsApp de pequenos negócios: o dono descreve como a
empresa funciona, e a IA atende, qualifica, agenda, registra e chama um humano quando
precisa — **sem ninguém desenhar fluxo**.

## A categoria (e por que é nova)

| Ferramenta | O que faz | Quem trabalha |
|---|---|---|
| Callbell | organiza o atendimento (inbox) | o humano atende |
| ManyChat / Devzapp | automatizam funil | o dono **desenha** o fluxo |
| **Hermes** | **opera** o atendimento por IA | a **IA** atende; o dono só descreve |

Posicionamento: **"IA operacional para WhatsApp de PME"** — não é ferramenta de marketing
para montar funil; é um funcionário digital de atendimento.

## A tese (o diferencial defensável)

**Sem construtor de fluxo.** O cliente preenche o `TenantConfig` (perfil, regras, objetivos,
tools habilitadas) e sobe documentos (knowledge base). A IA decide a conversa dentro disso.
É o "construtor de fluxo invisível": informa-se a **regra**, não o **caminho**.

## Princípios de arquitetura (o que torna escalável e seguro)

1. **Um motor, N configs.** O comportamento é código único; o que muda por cliente é só
   dado (config + knowledge). Nenhum cliente é código — por isso escala e por isso vende.
2. **A IA propõe, o balcão executa.** O cérebro sugere ações em JSON; o código valida
   (permissão, tenant, contato, dados) e executa. A IA nunca toca o banco.
3. **Guard-rails determinísticos.** Promessas proibidas, tools permitidas, gatilhos de
   handoff, isolamento por contato — aplicados pelo código, nunca confiados ao prompt.
4. **Coleira.** O cérebro é geração de texto pura, sem acesso ao sistema. O poder vem do
   catálogo de ações que o balcão executa, não de soltar o modelo.

## Os módulos (priorizados — não os 7 de uma vez)

**Núcleo (o que vende):**
- Cérebro IA (atende, entende, decide) — *em construção*
- Parametrização por empresa (`TenantConfig`) — *fundação pronta*
- Inbox: conversas, status, assumir/devolver, resumo automático
- Leads automáticos + handoff humano
- Tickets / agendamento (as "mãos" da IA)
- Dashboard de resultado

**Depois (quando o núcleo vender):**
- CRM + funil automático (a IA move o lead; o humano corrige)
- Campanhas + follow-up com aprovação humana
- Analytics avançado
- Integrações (webhook, pagamento, estoque…)

## O que o Hermes NÃO é (anti-escopo)

- Não é construtor visual de fluxo.
- Não é disparo em massa / automação de grupo / marketing agressivo.
- Não é ferramenta de marqueteiro — o foco é **atendimento operacional**.

Esses recursos inflam o produto, diluem o diferencial e muitos dependem de WhatsApp
não-oficial. Referência de mercado: Callbell e Devzapp — para se diferenciar, não para copiar.

## Roadmap

- **F2 — Cérebro IA real** *(em andamento)*: providers (mock → claude_cli → api), JSON
  validado, handoff automático, fallback seguro, `TenantConfig`.
- **F3 — Central de atendimento**: inbox, assumir/devolver, status, notas, resumo, painel de
  leads. *(primeira versão "SaaS")*
- **F4 — Parametrização**: tela onde o cliente configura sem programar.
- **F5 — CRM + funil automático**: pipeline movido pela IA, corrigível pelo humano.
- **F6 — Campanhas + follow-up**: sempre com limite, opt-out e logs.
- **F7 — WhatsApp oficial**: Business Platform (templates, webhook, janela de 24h).
- **Transversal:** um spike fino de WhatsApp cedo, só para de-riscar o canal.

## Estado atual (o que já roda)

- Cérebro IA plugável via **Claude CLI** (headless, com coleira), validação determinística,
  fallback seguro, handoff.
- Demo **Prestacon** (contabilidade): responde da base, abre/consulta chamados, com
  **isolamento por contato provado** (cliente B não vê o chamado do A).
- **TenantConfig** plugado no fluxo: um motor, N configs.
- Branch `feat/atendente-ia`.

## MVP vendável (o recorte para piloto)

WhatsApp (simulado ou sandbox) · inbox · IA atendente · parametrização da empresa · base de
conhecimento · leads automáticos · handoff humano · tickets/agendamento · follow-up simples ·
dashboard de resultados. → suficiente para um piloto apresentável.

## Nome e marca

**Hermes** — decidido. A marca voltada ao cliente é "Hermes" (mensageiro). O **agente
interno** `hermes` (orquestrador da DGC) continua existindo nos bastidores como ferramenta
técnica; quando houver risco de confusão, refere-se a ele como `hermes-agent`. O produto é o
app deste repositório; o agente é uma ferramenta separada da DGC.
