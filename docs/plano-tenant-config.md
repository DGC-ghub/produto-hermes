# Plano — TenantConfig (o motor da parametrização)

> Status: **rascunho para validação do Gabriel**. Nada de código antes do "pode ir".
> Continua a **Fase 2** (cérebro plugável). Resolve a tensão central: usar o poder do
> contexto rico (Claude CLI / arquivos por cliente) **sem** cada cliente virar uma gambiarra.

## 1. Objetivo

Uma estrutura única e declarativa — o `TenantConfig` — que descreve **como cada empresa
funciona**. O cliente não desenha fluxo: ele **descreve o negócio**. Dessa descrição o
balcão monta o contexto, as regras e as ferramentas que o atendente recebe.

**A regra-mãe: um motor só, N configs.** O comportamento (balcão, validação, retrieval,
providers) é código único e igual pra todos. O que muda entre clientes são **os valores do
config** e **o conteúdo da knowledge base** — nunca a lógica. Nenhum cliente é código.

## 2. A tensão que este desenho resolve

O "poder bruto" do Claude CLI tem **duas faces**, e elas precisam ser separadas:

- **Capacidade de processar contexto rico** (documentos, histórico, regras do negócio) →
  isto é ouro, **mantemos**. Escala e é seguro.
- **Acesso livre ao sistema** (criar pasta, navegar arquivos, "operar como funcionário
  digital" com shell/fs) → isto é a gambiarra que **não vai pro produto**. Não escala, não
  vende, e os próprios planos de segurança do Hermes já o proíbem ("atendente sem shell, sem
  fs, sem git").

> O medo de "cada cliente vira pasta/prompt/regra solta" só se concretiza se o **comportamento**
> for por-cliente. Aqui o comportamento é único; o cliente é só **dado** (config + knowledge).
> Por isso escala. O poder que mantemos é o de *contexto*, não o de *acesso*.

## 3. Os 4 princípios (a coleira da parametrização)

1. **Um motor, N configs.** Nunca `if (tenant === 'x')` no código. Se der vontade, vira
   **campo no config**. (Hoje o `TENANT_RULES[slug]` hard-coded em `rules.ts` é justamente o
   que estamos eliminando.)
2. **Declarativo, nunca imperativo.** O config diz **fatos e limites** (o quê), nunca **passos**
   (como). Se aparecer "mensagem 1 → espera → mensagem 2", voltou pro fluxo — recusa.
3. **Arquivo local = dado, não acesso.** O contexto rico vem da pasta `knowledge/<slug>/`,
   lida pelo **balcão** (isolada por `SAFE_SLUG`) e injetada via retrieval. A IA processa
   contexto rico, mas **nunca recebe o filesystem**. (Já é assim — `loadKnowledgeBase` +
   `retrieveRelevantChunks`. O config só formaliza.)
4. **O config é a fronteira de confiança.** O que a IA pode fazer (tools, preço, claims)
   está **declarado e limitado** no config. O que não está, não acontece. Isto **estende** o
   `validateAttendantOutput` que já existe.

## 4. O que já existe (e o TenantConfig só unifica)

| Hoje (espalhado / hard-coded)                         | Vira no TenantConfig                |
|-------------------------------------------------------|-------------------------------------|
| `companyRulesFor(slug)` + `BASE_RULES` (`rules.ts`)   | `businessProfile` + `extraRules`    |
| `TENANT_RULES[slug]` hard-coded no código             | config declarativo por tenant       |
| `FORBIDDEN_CLAIMS` global (`validate.ts`)             | global **+** `guardrails.forbiddenClaims` por tenant |
| `knowledge/<slug>/*.md` (`knowledge.server.ts`)       | `knowledge.sourceDir` (já é assim)  |
| `AttendantAction` (só `abrir_chamado`)                | `allowedTools` (whitelist por tenant) |

Conclusão: o `TenantConfig` **não é uma estrutura nova exótica** — é a externalização do que
já está no código. O caminho é extração, não reescrita.

## 5. Estrutura do TenantConfig

```ts
// app/lib/attendant/tenant-config.ts (proposto)

export type TenantObjective =
  | 'support' | 'sales' | 'lead_qualification' | 'scheduling' | 'billing'

export type HandoffTrigger =
  | 'payment' | 'legal' | 'complaint' | 'hot_lead' | 'out_of_knowledge' | 'sensitive'

export type ToolName =
  | 'create_lead' | 'update_lead_stage' | 'open_ticket'
  | 'schedule_meeting' | 'request_human' | 'send_webhook'

export type TenantConfig = {
  slug: string

  // Identidade — substitui o name + tom hoje hard-coded em rules.ts
  businessProfile: {
    name: string
    segment: string
    tone: string                  // ex.: "curto, natural e cordial"
    workingHours?: string
    address?: string
    channels?: string[]
  }

  // Objetivos — o que a IA persegue (não como). Vira contexto, não passo.
  objectives: TenantObjective[]

  // Regras comerciais — determinísticas; o balcão valida antes de executar/enviar.
  commercialRules: {
    canQuotePrice: boolean
    canGiveDiscount: boolean
    maxDiscountPercent?: number
    servedRegions?: string[]
    minTicket?: number
    paymentMethods?: string[]
  }

  // Guard-rails — ESTENDEM os globais do validate.ts, não substituem.
  guardrails: {
    forbiddenClaims: string[]     // somados a FORBIDDEN_CLAIMS global
    requireHumanFor: HandoffTrigger[]
    neverInvent: boolean          // fora do conhecimento => handoff
  }

  // Knowledge — conteúdo, não comportamento. Pasta por cliente (já existe).
  knowledge: { sourceDir: string }   // default: knowledge/<slug>/

  // Tools — whitelist. A IA PROPÕE; o balcão valida contra esta lista e executa.
  allowedTools: ToolName[]

  // Regras livres extras — o "TENANT_RULES[slug]" de hoje, agora no dado.
  extraRules: string[]
}
```

## 6. Como alimenta o attendant atual (o encaixe)

O `TenantConfig` é a **fonte da metade estática** do `AttendantInput` que já existe, e a
**fronteira de permissão** na saída. Nada de contrato novo no cérebro:

```
TenantConfig                                  AttendantInput (já existe)
────────────                                  ──────────────────────────
slug, businessProfile.name          ────────► tenant { slug, name }
businessProfile + commercialRules    ──┐
  + guardrails + objectives + extra    ├─────► companyRules: string[]   (hoje: companyRulesFor)
knowledge.sourceDir → retrieval      ──┴─────► knowledge: AttendantKnowledge[]
(balcão: banco)                      ────────► history · lead · myTickets
(canal)                              ────────► message

AttendantOutput.reply    ──► validate.ts (global) + guardrails.forbiddenClaims (tenant)
AttendantOutput.action   ──► balcão checa contra allowedTools ──► executa ou descarta
```

`companyRulesFor(slug)` deixa de ler um `Record` hard-coded e passa a **derivar do config**.
O resto do balcão não muda.

## 7. Onde mora o config (armazenamento)

- **Agora: arquivo** — `knowledge/<slug>/config.json` (ou `tenants/<slug>.json`). Coerente com
  o knowledge atual (pasta por tenant), versionável no git, editável à mão na validação, o
  Claude CLI lê fácil, **zero migration**.
- **Depois (fase 4): banco** — vira coluna/tabela no `Tenant` (Prisma) quando a tela de
  parametrização chegar. O **tipo** `TenantConfig` é o mesmo; só muda a fonte.
- A troca fica em **um lugar só**: uma função `loadTenantConfig(slug): TenantConfig`. Mesma
  estratégia plugável dos providers por env.

## 8. Faseamento (uma fatia por vez, valida antes da próxima)

- **TC1 — Tipo + loader + testes.** Define `TenantConfig` e `loadTenantConfig(slug)` lendo
  arquivo, com validação e testes. **Migra os 3 tenants de `rules.ts` pra arquivos de config.**
  Comportamento idêntico, mas agora declarativo. *(refactor seguro, sem mexer no fluxo)*
- **TC2 — Plugar no balcão.** `companyRulesFor` passa a derivar do config; `rules.ts`
  hard-coded é aposentado. Testes garantem a **mesma saída** de antes.
- **TC3 — Guard-rails + tools por tenant.** `validate.ts` aceita os `forbiddenClaims` do
  config (global + tenant); a execução de ação checa a whitelist `allowedTools`.
- **TC4 — Tela mínima de parametrização.** Um form (1 tela) que edita o config. É o item
  "parametrização" do MVP cortado.

## 9. Decisões abertas (preciso da tua opinião)

1. **Armazenamento:** arquivo agora → banco na fase 4 (proposta) — confirma?
2. **Validação do config:** manual (como o `validate.ts` já faz, sem lib nova) ou `zod`
   (robusto, mas é dependência fora da stack — exige teu ok). Proposta: **manual agora**.
3. **Objetivos:** começam como contexto no prompt (simples) ou já viram comportamento
   determinístico? Proposta: **contexto no prompt agora**; determinístico só quando doer.
4. **Versão do config no meio de uma conversa:** snapshot por conversa ou sempre o atual?
   Proposta: **sempre o atual** agora; snapshot só se virar problema.
