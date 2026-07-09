# Mapa de Polimento — Hermes (auditoria 2026-07-08)

## A verdade em uma frase
O Hermes **parece mais pronto do que está.** A identidade visual e o motor são excelentes, e
as telas-vitrine (home, demo, dashboard) impressionam. Mas faltam **funções essenciais** pro
cliente se virar sozinho — e são elas, não o visual, que separam "demo bonita" de "SaaS que vende".

---

## 🔴 Tier 1 — Bloqueadores de self-service (sem isso, não há o que vender)
Um cliente que se cadastra HOJE **não consegue, sozinho:**

1. **Conectar o WhatsApp dele.** Não existe tela — só via CLI (`tenant:add` + script). É a
   promessa da home, e está trancada atrás do SSH. → criar rota "Conectar WhatsApp" que chama
   `registerWhatsappNumber` / `setWhatsappCredential` (ambos já prontos e testados).
2. **Preencher a base de conhecimento** (FAQ / preços / serviços). Não existe tela; a própria
   `configuracoes.tsx:197` admite "edite os arquivos por enquanto". `writeKnowledgeDoc` já existe
   e valida — falta só a rota. É a **maior alavanca de qualidade** da IA (RAG vazia = IA que
   escala tudo).
3. **Saber o que fazer depois do cadastro.** Cai no `/atendente` vazio (config default sem tools,
   escala tudo) sem nenhum checklist "configure perfil → cole conhecimento → conecte WhatsApp".

---

## 🟡 Tier 2 — Fatura e escala (sem isso, o "S" de SaaS não se paga)

4. **Gate de cobrança.** `isSubscriptionActive` **nunca é chamado** — trial expira e o serviço
   continua de graça; cartão recusado não corta nada. Falta o gate antes de
   `processIncomingMessage` / `requireOperator` + uma tela de billing (plano atual, status, faturas).
5. **Handoff humano com resposta pelo painel.** Quando o humano "assume", o Hermes se cala — mas
   não há campo pra responder o cliente pelo WhatsApp a partir da Central. A última milha do
   atendimento fica no vácuo. Falta um campo que chame `sendWhatsAppMessage`.
6. **Provider `anthropic_api` faturável.** O motor roda na conta Claude **pessoal** da máquina via
   CLI (`spawn('claude')`) — problema de ToS ao revender e de margem (custo por conversa medido em
   lugar nenhum). Trava **escalar** a venda.

---

## 🎨 Tier 3 — Polimento visual (o "deixar bonito" que você pediu)

7. **Mobile na casca interna.** `AppShell` é `w-52` fixa, sem hamburger/drawer — num celular de
   375px engole ~55% da largura em TODAS as telas internas. É produto de **WhatsApp** (uso mobile):
   é o furo visual nº 1.
8. **Tela de erro / 404.** `root.tsx:63-88` está em **inglês**, sem estilo, sem marca. Um único 404
   destrói a percepção de "produto". Barato de arrumar, alto retorno.
9. **`/assinar` como tela de conversão.** Hoje é card cru (nome + preço + botão) — e é a tela de
   **receita**. Falta lista de features, plano recomendado, sinais de confiança ("cancele quando
   quiser", "sem cartão").
10. **Loading nos botões de ações lentas** (`signup`, `assinar`, "Gerar resumo" do atendente) —
    ficam mudos por segundos, sensação de "travou". O `demo.chat` já tem o padrão perfeito de
    optimistic UI; replicar.
11. **Empty states + design system.** Usar os SVGs prontos (`public/brand/empty-*.svg`) no
    `/atendente`; adotar `Toggle` e `StatusPill` (existem, nunca importados); criar os componentes
    que faltam (`Textarea`, `Select`, `Toast`) que hoje são recriados na mão.
12. **Limpar a UI de "coisa de dev".** Tirar o emoji ✅ do `verificar-email` (viola a própria regra
    do design system), o jargão de infra da demo ("faster-whisper / ~15s no Pi"), e trocar
    `<a href>` por `<Link>` nos cross-links (hoje recarregam a página inteira).

---

## ✅ O que já está forte (NÃO mexer — é o ativo)
- **Identidade visual**: verde + Bricolage/Hanken + a asa do mensageiro — coerente e autoral, não
  parece template.
- **Motor do atendente**: balcão + cérebro plugável, guard-rails determinísticos, isolamento por
  tenant, validador de saída forte.
- **Cockpit do operador** (`/atendente`, `/dashboard`): fila priorizada, dossiê, % de autonomia,
  sparkline — genuinamente bons.
- **Inbound do WhatsApp**: fila com dedup por wamid, HMAC, cortesia pra áudio/mídia.

---

## Recomendação de sequência
Se o objetivo é **vender pra um cliente real que se vira sozinho**, a ordem é: **Tier 1 → Tier 2 →
Tier 3**. O visual (Tier 3) deixa bonito, mas os buracos do Tier 1 é que impedem existir produto.
Um caminho pragmático: **#1 e #2 (conectar WhatsApp + knowledge na tela)** primeiro — são os dois
que transformam "demo" em "produto que o cliente opera" — e ao construí-los, aplicar o polimento
visual do Tier 3 nas telas novas, matando dois coelhos.
