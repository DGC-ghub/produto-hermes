# Hermes — Índice de Assets

> Índice legível por máquina dos arquivos em `/public/brand`.
> **Leia este arquivo em vez de abrir/analisar cada imagem.** Todos os assets seguem
> a mesma identidade (paleta + motivo da asa).

## Referência rápida
- **Paleta:** Verde primário `#0E7C5A` · Verde profundo `#0A3C2E` · Verde vivo `#34D399` · Fundo quente `#F7F7F4` · Tinta `#1A1F1C`
- **Tipografia:** títulos **Bricolage Grotesque** (Bold); corpo **Hanken Grotesk**.
- **Símbolo:** “asa do mensageiro” — 3 traços curvos ascendentes (o de cima em verde vivo).
- **Nota de fonte:** a palavra “Hermes” nos arquivos está desenhada em curvas de **Hanken Grotesk Bold** (substituto temporário da Bricolage). Ver `README.md`. `logo-horizontal-bricolage.svg` usa a Bricolage oficial via webfont.

## Marca (logos e símbolo) — fundo transparente
| Arquivo | Formato | O que é | Uso |
|---|---|---|---|
| `symbol.svg` | SVG 100×100 | Asa branca + acento vivo no squircle verde profundo | Símbolo/avatar da marca; base do app icon |
| `symbol-wing.svg` | SVG | Só a asa (#0E7C5A + topo vivo), sem container | Elemento gráfico solto, marca d’água, bullets |
| `logo-horizontal.svg` / `.png` | SVG / PNG @2x (alt. 240) | Lockup principal: símbolo + “Hermes” ao lado | Uso padrão: cabeçalhos, site, assinatura |
| `logo-stacked.svg` | SVG | Símbolo em cima, “Hermes” embaixo | Espaços quadrados/estreitos, selos, perfis |
| `logo-mono-white.svg` / `.png` | SVG / PNG @2x | Lockup 1 cor branca (sem container) | Sobre fundos escuros / fotos |
| `logo-mono-black.svg` | SVG | Lockup 1 cor tinta `#1A1F1C` | 1 cor, impressão P&B, fundos claros |
| `logo-on-green.svg` / `.png` | SVG / PNG @2x | Lockup com fundo verde profundo, asa branca+vivo, texto branco | Banners/cartões sobre o verde da marca |
| `logo-horizontal-bricolage.svg` | SVG | Igual ao horizontal, “Hermes” em texto vivo na webfont Bricolage | Web onde a Bricolage carrega (fonte oficial) |

## Ícones e favicon
| Arquivo | Formato | O que é | Uso |
|---|---|---|---|
| `favicon.svg` | SVG 100×100 | Símbolo simplificado (2 traços) no squircle, legível a 16px | Favicon vetorial |
| `favicon-32.png` | PNG 32×32 | Favicon raster pequeno | `<link rel=icon sizes=32x32>` |
| `favicon-512.png` | PNG 512×512 | Favicon grande / PWA | Manifest PWA, atalhos |
| `icon-1024.png` | PNG 1024×1024 | App icon (squircle full-bleed, asa de 3 traços) | Ícone de app iOS/Android/stores |
| `icon-512.png` | PNG 512×512 | Mesmo app icon, menor | Ícone de app / `apple-touch-icon` |

## Social
| Arquivo | Formato | O que é | Uso |
|---|---|---|---|
| `og.png` | PNG 1200×630 | Imagem de compartilhamento: logo + tagline “O atendente de WhatsApp que lembra de cada cliente” + balão verde | `<meta property="og:image">`, Twitter/X card |
| `og@2x.png` | PNG 2400×1260 | Versão 2x do OG | Telas de alta densidade |
| `og.svg` | SVG 1200×630 | Fonte vetorial do OG (texto em curvas) | Editar/re-exportar o OG |

## Ilustrações de estado vazio — linha única emerald, sem texto, transparente
| Arquivo | Formato | O que é | Uso |
|---|---|---|---|
| `empty-caught-up.svg` / `@2x.png` | SVG / PNG 560×440 | Avião de papel + traços de velocidade | Estado “Tudo em dia” (fila vazia) |
| `empty-no-conversations.svg` / `@2x.png` | SVG / PNG 560×440 | Balão de conversa com a asa dentro | Estado “Nenhuma conversa ainda” |
| `empty-no-results.svg` / `@2x.png` | SVG / PNG 560×440 | Lupa com asa sutil | Estado “Sem resultados” |

## Padrão de fundo
| Arquivo | Formato | O que é | Uso |
|---|---|---|---|
| `pattern.svg` | SVG (tile 224, sem emenda) | Asas esparsas, baixíssimo contraste, transparente | Background de seções (landing/login) sobre `#F7F7F4` |
| `pattern-preview.png` | PNG 1200×560 | Prévia do padrão sobre o fundo quente | Referência apenas (não usar como bg) |

## Docs
| Arquivo | O que é |
|---|---|
| `README.md` | Documentação geral: paleta, tipografia, snippets de favicon/OG/CSS, licenças |
| `ASSETS.md` | Este índice |
