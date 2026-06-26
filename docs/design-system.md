# Design System & Plano do Front — Hermes

> Fonte da verdade visual do Hermes. Definido na sessão de 25–26/06/2026 (direção
> **Mensageiro**, identidade autoral). Toda tela nova ou repaginada herda daqui.
> Princípio: **a IA propõe (JSON), o balcão valida e executa** — o front é o balcão.

---

## 1. Visão

O Hermes tem **dois mundos** com objetivos opostos, e cada um tem a sua casca:

- **Público** — vende e demonstra. Casca de site: header magro + CTA. Telas: Landing, Demo, Login.
- **Interno** — o operador trabalha. Casca de app: barra lateral fixa que carrega a empresa (tenant). Telas: Central do atendente, Dashboard, Configurações.

Hoje cada tela é um `<main>` solto, sem casca — é o que faz o conjunto parecer protótipo. A casca compartilhada é a primeira coisa a construir.

---

## 2. Identidade

### 2.1 Direção: "Mensageiro"

Território do WhatsApp, elevado: verde esmeralda sóbrio (não o verde-néon do app), neutros quentes, sem cara de "SaaS frio". Familiar de cara, sem virar clone.

### 2.2 Paleta (tokens)

| Token | Hex | Papel |
|---|---|---|
| `brand` | `#0E7C5A` | Primária: botões, links, destaque, "resolvido" |
| `brand-deep` | `#0A3C2E` | Sidebar, superfícies de marca, hover, faixa CTA |
| `brand-vivid` | `#34D399` | Realce/acento vivo, usar com parcimônia |
| `bg` | `#F7F7F4` | Fundo da página (branco quente, não cinza-azulado) |
| `surface` | `#FFFFFF` | Cartões e superfícies |
| `border` | `#E6E7E2` | Hairlines / divisores |
| `ink` | `#1A1F1C` | Texto primário (quase-preto esverdeado) |
| `ink-soft` | `#5B635E` | Texto secundário |

**Status do atendimento** (semânticos):

| Token | Hex | Significado |
|---|---|---|
| `urgent` | `#DC4B3E` | Precisa de humano (o que mais importa ver rápido) |
| `waiting` | `#E0922F` | Aguardando cliente |
| `resolved` | `#0E7C5A` | Resolvido (= cor de marca: verde é positivo) |
| `ai` | `#3B82C4` | IA no ar / conduzindo |

> Selos de status = **ponto colorido + texto neutro**, nunca bloco de cor cheio. Leem rápido e não viram árvore de natal numa fila cheia.

### 2.3 Tipografia

Escolha **autoral** (anti-template): foge do par seguro Inter/Manrope de propósito.

- **Títulos:** `Bricolage Grotesque` (bold/extrabold), `letter-spacing` levemente negativo (-0.3 a -0.6px) nos tamanhos grandes. Tem personalidade e uma imperfeição charmosa.
- **Corpo / UI:** `Hanken Grotesk` (400/500). Quente e legível, mais alma que Inter.

Escala: hero ~30px / título de tela ~17–20px / corpo 13–15px / auxiliar 11–12px. Sempre **sentence case**. Dois pesos por papel (regular + bold), sem 600/700 no corpo.

### 2.4 Marca: a asa do mensageiro

Hermes é o mensageiro alado. O símbolo é **três traços curvos ascendentes** (esquerda → direita, comprimentos decrescentes) — lê como asa/pena e velocidade. O traço de cima pode ser `brand-vivid`, os outros brancos. Dentro de um *squircle* `brand-deep`.

É também o **signature**: a asa reaparece nos momentos do Hermes — o logo, o avatar do atendente IA nas bolhas, o ícone de "enviar". É o que se lembra depois de fechar a aba.

### 2.5 Voz (copy)

PT-BR, sentence case, verbo na frente. Botões dizem o que fazem ("Assumir conversa", não "OK"). Estados vazios convidam ("Tudo em dia" > "Nada aqui"). Erros dizem o que houve e o que fazer, sem pedir desculpa nem expor stack. Sem emoji na UI.

---

## 3. Fundação técnica (como a identidade vira código)

### 3.1 Tokens — `app/app.css` (Tailwind v4 `@theme`)

```css
@theme {
  --color-brand: #0E7C5A;
  --color-brand-deep: #0A3C2E;
  --color-brand-vivid: #34D399;
  --color-bg: #F7F7F4;
  --color-surface: #FFFFFF;
  --color-border: #E6E7E2;
  --color-ink: #1A1F1C;
  --color-ink-soft: #5B635E;
  --color-urgent: #DC4B3E;
  --color-waiting: #E0922F;
  --color-ai: #3B82C4;
  --font-display: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif;
  --radius: 0.5rem;     /* controles */
  --radius-card: 0.75rem;
}
```

Isso gera utilitários (`bg-brand`, `text-ink`, `border-border`, `font-display`…). Dark mode pode vir depois — por ora o produto é claro.

### 3.2 Fontes — `app/root.tsx`

Trocar o `<link>` do Inter por Bricolage Grotesque + Hanken Grotesk (Google Fonts no MVP; self-host como otimização futura por performance/privacidade).

---

## 4. Biblioteca de componentes — `app/components/ui/`

Hoje os padrões (badge, botão, card) estão repetidos inline em cada rota. Extrair para componentes tipados é o que garante coerência.

| Componente | Função | Variações |
|---|---|---|
| `Button` | Ação | `primary` (verde), `secondary` (borda), `ghost` |
| `StatusPill` | Status do atendimento | ponto + label; `urgent`/`waiting`/`resolved`/`ai` |
| `Tag` | Chip de contexto | com ícone opcional (lead quente, 3ª conversa) |
| `Card` | Superfície | base / com borda |
| `Avatar` | Iniciais do contato | cor por seed; tamanhos |
| `Toggle` | Liga/desliga (regras) | on/off |
| `TextField` | Entrada de texto | label + input |
| `BrandMark` | O símbolo (asa SVG) + logo | símbolo / horizontal / empilhado / mono |

Cada componente puro ganha um teste de render simples (`*.test.tsx`).

---

## 5. Casca / layouts (React Router v8)

Usar **layout routes** para não repetir casca nem gate em cada tela:

```ts
// app/routes.ts
export default [
  layout("routes/_public.tsx", [
    index("routes/home.tsx"),        // Landing
    route("demo/chat", "routes/demo.chat.tsx"),
    route("login", "routes/login.tsx"),
  ]),
  layout("routes/_app.tsx", [        // loader central com requireOperator
    route("atendente", "routes/atendente.tsx"),
    route("dashboard", "routes/dashboard.tsx"),
    route("configuracoes", "routes/configuracoes.tsx"),
  ]),
  route("logout", "routes/logout.tsx"),
  route("webhook/whatsapp", "routes/webhook.whatsapp.tsx"),
] satisfies RouteConfig
```

- `routes/_public.tsx` — header (logo + nav + CTA "Testar grátis") + `<Outlet/>`.
- `routes/_app.tsx` — **sidebar** `brand-deep` (logo, nav Central/Dashboard/Config, rodapé com tenant + sair) + `<Outlet/>`. O `loader` chama `requireOperator(request)` **uma vez**, centralizando o gate que hoje está espalhado.

---

## 6. As telas (todas mockadas em alta fidelidade)

**Central do atendente** (`atendente.tsx`) — o coração. Duas colunas: fila ordenada **por urgência** (não por chegada) + painel do contato com o **resumo do Hermes** no topo, chips de memória (`3ª conversa`, `lead quente`, `chamado aberto`), conversa em bolhas estilo zap, e a **trava** "assuma pra responder" (guard-rail: a IA escalou e se calou).
Estados: fila vazia ("tudo em dia"), IA em fallback (o 401 do `claude_cli`), sem conexão.
Ações a incluir: assumir, responder, encerrar, transferir, resolver chamado.

**Dashboard** (`dashboard.tsx`) — ROI pro dono: métricas (conversas, **% resolvido sem humano**, leads, 1ª resposta), conversas/dia, motivos de escalação, leads recentes.

**Configurações** (`configuracoes.tsx`) — **NOVA**. Perfil da empresa, regras do atendente (toggles), base de conhecimento (upload + status). Hoje isso é JSON em `config/tenants/<slug>.json`; a tela precisa **persistir** — ver decisão na Fase 3.

**Landing** (`home.tsx`) — hero (headline Bricolage + preview de conversa), 3 benefícios, faixa CTA `brand-deep`.

**Demo** (`demo.chat.tsx`) — chat público; cada resposta da IA **cita a fonte** (a base de conhecimento). Texto + áudio (o `AudioRecorder` já existe).

**Login** (`login.tsx`) — split: painel de marca `brand-deep` + formulário.

---

## 7. Plano de implementação (faseado)

Cada fase é entregável e testável sozinha. Antes de "pronto": `npm run typecheck`, `npm test`, `npm run lint`. Commits pequenos em Conventional Commits.

### Fase 1 — Fundação + casca *(invisível, mas sustenta tudo)*
- [ ] Tokens no `app/app.css` (`@theme`: cores, fontes, raios)
- [ ] Fontes Bricolage + Hanken no `app/root.tsx`
- [ ] `app/components/ui/`: Button, StatusPill, Tag, Card, Avatar, Toggle, TextField
- [ ] `app/components/brand/BrandMark.tsx` (asa em SVG + logo)
- [ ] Layouts `routes/_public.tsx` e `routes/_app.tsx` (+ `requireOperator` central)
- [ ] Atualizar `app/routes.ts` para aninhar nos layouts
- [ ] Testes de render dos componentes

### Fase 2 — A Central *(o coração e a demo)*
- [ ] Repaginar `atendente.tsx` com os componentes ui
- [ ] Fila por urgência + painel + resumo em destaque + chips de memória
- [ ] Barra de ações (assumir/responder/encerrar/transferir/resolver)
- [ ] Estados: vazio, IA em fallback, erro

### Fase 3 — Resto do interno
- [ ] `dashboard.tsx`: métricas + gráfico (CSS bars; lib só se necessário)
- [ ] `configuracoes.tsx` (rota nova) + nav na sidebar
- [ ] **Decisão de persistência do TenantConfig:** editar o JSON via `action`, ou migrar para um `model` Prisma. Recomendo começar pelo JSON (menos disruptivo) e migrar se a edição crescer.

### Fase 4 — Mundo público
- [ ] `home.tsx` (Landing), `demo.chat.tsx` (Demo), `login.tsx` (split)
- [ ] Header público no `_public.tsx`

---

## 8. Apêndice — Ativos visuais (logo e imagens)

**Logo é vetor (SVG), não imagem gerada** — geradores fazem logo borrado/ilegível. O símbolo da asa já nasce em SVG (`BrandMark`). Imagens/ilustrações (Open Graph, empty states, texturas) sim podem ser geradas, com paleta restrita à marca e o motivo da asa. Destino sugerido: `/public/brand/` (symbol.svg, logo-horizontal.svg, logo-stacked.svg, logo-mono-white.svg, favicon.svg, icon-512.png, og.png, empty-*.svg). Briefing completo de produção mantido à parte para a sessão de assets.
