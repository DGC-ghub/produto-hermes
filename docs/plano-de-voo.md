# 🪶 Plano de Voo — Hermes

> Abra este arquivo no começo de cada sessão. Faça **uma** caixinha. Marque, commite, pronto.
> Você avançou hoje. Não precisa de pique de maratona — precisa de 1 passo por dia.

---

## 🎯 A linha de chegada

**Um cliente real sendo atendido pelo Hermes no WhatsApp dele — e pagando** (mesmo que pouco,
mesmo que no Pix, mesmo que combinado na unha). Isso é "funcionar de verdade". É o que destrava
tudo: confiança, os próximos clientes, e a conversa com o anjo investidor (tração > deck).

Não é "terminar o SaaS". É **um negócio sendo bem atendido**, de ponta a ponta, sozinho.

---

## 💪 Você está mais perto do que sente

Já está de pé e funcionando:
- O **motor** de atendimento (IA atende, decide, qualifica, abre chamado, escala pro humano).
- **WhatsApp real provado** — não é teoria, já trocou ~12 mensagens de verdade.
- **Memória do cliente**, dossiê, central do atendente, fila por urgência.
- **Auth multi-tenant** (cada empresa só vê o seu — o isolamento que vira plataforma).
- O **front inteiro** repaginado: login, central, dashboard, landing, demo.

Falta **pouco** pro produto, e o que falta pro 1º *cliente* é mais curto ainda. Veja a tese:

## 🧭 A tese do caminho curto

> Pro **primeiro** cliente, quase tudo pode ser **manual**. Você não precisa do SaaS completo
> pra ter alguém pagando. Você precisa de **uma** empresa sendo bem atendida no WhatsApp, de
> forma estável. O resto (cadastro automático, cobrança automática, App Review da Meta) é o que
> você constrói **depois** que já tem tração — não antes.

Configurar o cliente na mão? Ok. Cobrar no Pix? Ok. Um número de WhatsApp dedicado? Ok. O que
**não** pode faltar é: o Hermes respondendo sozinho, certo, num WhatsApp real, sem cair.

---

## ✈️ As fases (cada caixinha ≈ 1 sessão)

### Fase 0 — Acabar o produto pro piloto · *você está aqui*
- [ ] **Tela de Configurações** — você descreve a empresa (perfil, tom, regras, tools, escalação) por uma tela, em vez de editar JSON na mão. *(é a tarefa de hoje)*
- [ ] **IA real estável** — garantir que o `claude_cli` está logado **ou** pôr `ANTHROPIC_API_KEY` no `.env`, pra não cair em fallback no meio de um atendimento real.

> **Marco:** o produto está "bom o suficiente" pra um cliente de verdade usar.

### Fase 1 — WhatsApp real, estável, 24/7 · *o gargalo de verdade*
- [ ] **Regenerar o token da Meta** (o atual passou por chat — segurança).
- [ ] **Tocar o ciclo completo** de novo num número de teste (recebe → IA → responde), pra confirmar que tudo religa.
- [ ] **Decidir a hospedagem do piloto:** Pi sempre ligado + ngrok reservado (grátis, mais frágil) **ou** um VPS baratinho (~R$30/mês, estável). Pro 1º piloto, Pi+ngrok pode servir — não trave aqui.

> **Marco:** o Hermes responde sozinho num WhatsApp real, de forma confiável, por dias.

### Fase 2 — Escolher e montar o 1º cliente
- [ ] **Definir QUEM** é o piloto (a própria DGC? um conhecido com WhatsApp movimentado e uma dor real de perder mensagem?).
- [ ] **Escrever a knowledge dele** (perfil, FAQ, preços, tom) — você já tem o formato em `knowledge/<slug>/`.
- [ ] **Configurar o tenant** dele (na tela nova!) e **conectar o WhatsApp**.

> **Marco:** existe um cliente real configurado, pronto pra atender.

### Fase 3 — Piloto ao vivo + a primeira grana
- [ ] **Rodar X dias** atendendo de verdade, acompanhando pela Central.
- [ ] **Ajustar a config** com o que aparecer na prática.
- [ ] **Combinar um valor** e receber (Pix). Alguém pagando = **tração**.

> **Marco:** 🎉 **1º cliente pagante.** A meta. Daqui a captação vira outra conversa.

### Fase 4 — Só depois da tração · *permissão pra NÃO fazer agora*
App Review da Meta (atender qualquer número), cadastro self-service, billing automático,
hospedagem robusta/escalável, multi-cliente em massa, os outros módulos (nota, financeiro).
**Nada disso é pré-requisito pro 1º cliente.** Deixa quieto até ter tração.

---

## 🔁 A regra diária (anti-desânimo)

1. Abra este arquivo.
2. Faça **a próxima caixinha não-marcada**. Só uma. Sem culpa por não fazer mais.
3. Marque `[x]`, commite. **Você avançou hoje.**

São ~11 caixinhas até o 1º cliente pagante. Uma por dia = **menos de duas semanas**.
O desânimo perde pra constância. Aparecer todo dia > surto de fim de semana.

## 📍 Onde você está agora

👉 **Fase 0 · Configurações.** A boa notícia: a parte difícil (persistência) já está pavimentada
no código — é só salvar de volta no `config/tenants/<slug>.json`. Bora.
