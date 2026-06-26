# Hermes — Kit de Marca

Identidade visual do Hermes, o atendente de IA de WhatsApp. Tudo em vetor (SVG),
com PNGs @2x para as peças de imagem. Símbolo da marca: a **asa do mensageiro** —
três traços curvos ascendentes (o de cima em verde vivo).

## Paleta
| Token | Hex | Uso |
|---|---|---|
| Verde primário | `#0E7C5A` | cor principal, traços, links |
| Verde profundo | `#0A3C2E` | fundo do squircle, fundos escuros |
| Verde vivo | `#34D399` | acento (traço de cima da asa) |
| Fundo quente | `#F7F7F4` | fundo padrão |
| Tinta | `#1A1F1C` | texto |

## Tipografia
- Títulos: **Bricolage Grotesque** (Bold) — `https://fonts.google.com/specimen/Bricolage+Grotesque`
- Corpo: **Hanken Grotesk** — `https://fonts.google.com/specimen/Hanken+Grotesk`

> **Nota sobre o logotipo.** A palavra “Hermes” nos arquivos `.svg`/`.png` foi
> desenhada (convertida em curvas) usando **Hanken Grotesk Bold** como
> **substituto temporário**, porque a Bricolage Grotesque não pôde ser baixada
> no ambiente onde o kit foi gerado (acesso de rede restrito). Para finalizar com
> a fonte oficial, escolha uma opção:
> 1. Use `logo-horizontal-bricolage.svg` — usa a webfont Bricolage via `@import`
>    (renderiza correto em navegador/web onde a fonte é carregada); ou
> 2. Instale a Bricolage Grotesque e me peça para re-exportar — troco a fonte e
>    gero os logos em curvas em um passo.

## Arquivos
**Marca**
- `symbol.svg` — asa dentro do squircle verde profundo (fundo transparente)
- `symbol-wing.svg` — só a asa (#0E7C5A + topo vivo)
- `logo-horizontal.svg` / `.png` — símbolo + “Hermes” lado a lado
- `logo-stacked.svg` — símbolo em cima, “Hermes” embaixo
- `logo-mono-white.svg` / `.png` — mono branca (fundos escuros)
- `logo-mono-black.svg` — mono preta
- `logo-on-green.svg` / `.png` — lockup sobre verde profundo
- `logo-horizontal-bricolage.svg` — versão com a fonte oficial via webfont

**Ícones / Favicon**
- `icon-1024.png`, `icon-512.png` — app icon (squircle full-bleed)
- `favicon.svg` — símbolo simplificado (2 traços), legível a 16px
- `favicon-32.png`, `favicon-512.png`

**Social**
- `og.png` (1200×630), `og@2x.png`, `og.svg` — imagem de compartilhamento

**Ilustrações de estado vazio** (linha única, sem texto)
- `empty-caught-up.svg` — “Tudo em dia”
- `empty-no-conversations.svg` — “Nenhuma conversa ainda”
- `empty-no-results.svg` — “Sem resultados”
- (+ `*@2x.png`)

**Padrão**
- `pattern.svg` — textura de asas, esparsa e de baixíssimo contraste (overlay)
- `pattern-preview.png` — prévia sobre o fundo quente

## Snippets úteis
```html
<!-- favicon -->
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/brand/icon-512.png">

<!-- open graph -->
<meta property="og:image" content="/brand/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
```
```css
/* padrão de fundo */
.section--pattern { background: #F7F7F4 url('/brand/pattern.svg'); }
```

## Licenças das fontes
Hanken Grotesk e Bricolage Grotesque: SIL Open Font License 1.1 (uso livre,
inclusive comercial).
