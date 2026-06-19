# Regra de Negócio (rascunho) — SaaS de Atendimento WhatsApp por IA

> Etapa 1 da esteira · 1ª corrida — vai ser lapidado.

## Problema
Negócios pequenos atendem no WhatsApp manualmente: não escala, demora e perde venda. Não têm equipe de atendimento.

## Público
- Pequenos/médios negócios que vendem e atendem por WhatsApp.
- 1º usuário: a própria DGC (dogfooding).
- _(Em aberto: focar num nicho específico no começo?)_

## O que o produto faz
Prioridade do Gabriel: **IA > CRM > caixa de entrada > campanhas**.

1. **Conexão com o WhatsApp** — base técnica ("encanamento"): receber e enviar mensagem.
2. **Atendimento por IA (Hermes)** — responde o cliente consultando uma **base de conhecimento** (pasta com as respostas/FAQs daquele cliente). Padrão **RAG**: acha o tópico → busca a resposta → responde. Serve pra:
   - tirar dúvidas (horário, preço, FAQ)
   - vender / qualificar (puxar pra compra ou agendamento)
3. **CRM** — cadastro de clientes, histórico, etiquetas, funil.
4. **Caixa de entrada da equipe** — atendente humano vê/responde quando precisa.

## Regras
- Cada cliente tem **sua própria base de conhecimento** (pasta de respostas) que a IA consulta.
- A IA resolve sozinha o que está na base; ao vender, guia o cliente pro próximo passo.
- **Passagem pra humano:** o mínimo possível, mas **não zero**, e **configurável por cliente** (ex.: quando o cliente pede, ou quando a IA não acha a resposta).

## Fora de escopo (v1)
- Campanhas / disparos em massa → roadmap.
- _(definir mais conforme fechamos o v1)_

## Em aberto (próximas conversas)
- ~~O Hermes já existe ou construir?~~ → **Construir do zero** (não existe nada ainda). ✅
- Nicho-alvo do v1.
- O que exatamente é "personalizável" por cliente.
- Preço / modelo de cobrança.
- WhatsApp: confirmar **API oficial** (custo/aprovação).
- Onde roda em produção (Pi vs nuvem).
- LGPD: a gente guarda conversa de cliente — precisa de cuidado legal.
