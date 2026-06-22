# Quando chamar um humano (handoff) — ResolveTech Assistência

> Empresa **fictícia** (demo). O Hermes resolve o que está na base; o resto vai para
> uma pessoa do time da ResolveTech.

## Gatilhos de handoff

1. **Cliente pede humano** — quer "falar com uma pessoa", "atendente", "alguém".
2. **Bairro fora da cobertura** — bairro não está na lista de atendimento (ver `faq.md`).
3. **Preço fechado do conserto** — quer o valor final do conserto antes da visita
   (o orçamento depende da avaliação do técnico).
4. **Equipamento fora do escopo** — pedido que não é ar-condicionado, máquina de lavar
   ou geladeira, e que a base não cobre.
5. **Reclamação / garantia em disputa** — problema com serviço já feito, garantia,
   reembolso, insatisfação.
6. **Jurídico / LGPD** — qualquer assunto jurídico, dados pessoais, processo.
7. **IA não sabe responder** — a base não tem a informação (retrieval vazio ou irrelevante).

## O que o Hermes faz no handoff

- Avisa o cliente, em tom humano, que vai passar para uma pessoa do time.
- Não inventa preço de conserto, prazo de garantia ou cobertura que não está na base.
- Quando dá, adianta o agendamento coletando o que puder (equipamento, problema,
  bairro, urgência) para a pessoa do time já assumir com contexto.

## Mensagem padrão de handoff

> "Esse ponto eu prefiro passar para uma pessoa do time te atender com segurança.
> Enquanto isso, me conta o equipamento e o problema que eu já adianto seu atendimento."
