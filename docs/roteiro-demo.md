# Roteiro de Demo — Hermes

> Demo guiada (~8 min) para apresentar o Hermes ao sócio (HXG) e ao investidor.
> Arco: **dor → a IA atende → ele lembra do cliente → copiloto do atendente →
> pronto pra escalar (SaaS) → o negócio.**

## Antes de começar (checklist)
- [ ] App no ar: `https://cryptobot.tail04b4ef.ts.net:5174/` (celular) ou `https://localhost:5174/`
- [ ] No navegador, aceitar o aviso de certificado ("Avançar mesmo assim").
- [ ] `ATTENDANT_PROVIDER=claude_cli` no `.env` (IA real; sem isso o motor responde no modo `mock`).
- [ ] Duas abas prontas: **(A)** `/demo/chat` e **(B)** `/atendente` já logado como
      `assistencia-tecnica-demo` / `hermes-dev`.
- [ ] Saber a frase de efeito do fecho (no fim deste doc).

> A IA "digita" por ~10s por resposta — é **proposital**, parece humano. **Narre durante**,
> não fique em silêncio. Se a IA falhar, troque pro provider `mock` (instantâneo, à prova de falha).

---

## Ato 0 — O gancho (30s) · sem tela
> "Quantos clientes vocês conhecem que mandaram mensagem no WhatsApp de uma empresa e…
> nada? Ou demorou tanto que desistiram? Cada um desses é **dinheiro que evaporou**. O
> Hermes é um atendente de IA que não dorme, não demora, e **nunca esquece um cliente**."

## Ato 1 — A IA atende de verdade (2 min) · aba A `/demo/chat`
1. Selecionar a empresa **ResolveTech Assistência**.
2. Digitar como cliente:
   > `Boa tarde, minha geladeira parou de gelar e eu guardo insulina nela. Preciso muito de ajuda.`
3. (Hermes acolhe, reconhece a urgência, pede os dados que faltam.)
4. Digitar:
   > `Sou a Dona Helena, meu zap é 11 97777-1234, e moro no Centro.`
5. (Hermes registra e abre o chamado.)

**Fala:** "Reparem: **não programei fluxo nenhum**. Não tem 'aperte 1 para isso'. É IA de
verdade entendendo, medindo a urgência, pedindo só o que falta e já abrindo o chamado. O dono
só **descreveu a empresa uma vez** — o resto a IA decide."

## Ato 2 — O "wow": ele lembra do cliente (1,5 min) · aba A
1. Voltar pra home/“Atendente” e abrir o `/demo/chat` de novo (simular que o cliente saiu).
2. Digitar:
   > `Esqueci de perguntar: o técnico consegue vir ainda hoje?`
3. (Hermes **continua a conversa** — ainda sabe que é a Dona Helena, da geladeira, urgente.)

**Fala:** "Viram? Ele **não me tratou como estranho**. Lembrou meu nome, meu problema. No
WhatsApp real, é o **número** do cliente que ele reconhece — a pessoa volta semana que vem e
ele continua de onde parou. Isso é o que separa um chatbot de um **atendente de verdade**."

## Ato 3 — O copiloto do atendente humano (2,5 min) · aba B `/atendente`
1. Mostrar a **fila** (logado como ResolveTech): **Marta Souza** (prioridade Alta) e a do drone.
2. Clicar na **Marta** → mostrar o **dossiê**: nome, telefone, bairro, urgência, **chamado
   aberto de geladeira**, a conversa, e **por que** chegou ao humano.

**Fala:** "Quando o Hermes decide que precisa de um humano, ele não joga o problema no colo do
atendente. Ele entrega **isto**: a ficha pronta. Quem é, o que já pediu, que tem um chamado
aberto, que é urgente por causa da insulina, e exatamente por que escalou. O atendente senta e
em **5 segundos sabe tudo** — não lê 40 mensagens nem pergunta o nome de novo. É um copiloto."

## Ato 4 — Pronto pra escalar: isolamento por empresa (1 min) · aba B
1. Clicar em **Sair**. Logar como `dgc` / `hermes-dev`.
2. Mostrar que a fila agora tem **só o cliente da DGC** (o caso do contrato) — **nada** da ResolveTech.

**Fala:** "Cada empresa só vê os **próprios** clientes. A ResolveTech nunca enxerga a DGC e
vice-versa. Isso não é detalhe: é o que faz disso um **SaaS de verdade**, que dá pra vender
pra 100 empresas com segurança. E **já está construído**."

## Ato 5 — O negócio (1,5 min) · sem tela
> "O que vocês viram é o **Módulo 1**: o atendente de WhatsApp. É a porta de entrada — a dor é
> aguda e o ROI é óbvio: **quanto vale não perder mais nenhum lead?**
>
> Por baixo, é uma **plataforma modular**. O mesmo login amanhã abre nota fiscal, financeiro,
> gestão — o cliente paga pelos módulos que usa. A gente entra barato e **cresce dentro do cliente**.
>
> O plano: validar com os primeiros clientes pagando o módulo de atendimento, e aí acelerar.
> *(pro investidor)* É aqui que seu apoio vira **tração de mercado** — o produto já está de pé."

---

## Frase de efeito (fecho)
> "Não é um chatbot. É um **funcionário digital que lembra de cada cliente** — e cresce com a empresa."

## Plano B (se algo falhar)
- IA lenta/sem internet → `.env`: `ATTENDANT_PROVIDER=mock`, reinicia o dev. Respostas instantâneas (menos "wow", mas não trava).
- Esqueceu o login → usuários: `dgc`, `assistencia-tecnica-demo`, `prestacon`; senha `hermes-dev`.
- Quer recomeçar a conversa do cliente → abra `/demo/chat` numa aba anônima.
