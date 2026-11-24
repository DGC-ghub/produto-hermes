# Amostras do tenant dgc-vendas (DGC-265)

Conversas reais pelo motor (`public_demo`, provedor `claude_cli`), 24/11/2026. Dados fictícios.

### preco

- Clínica: Oi! Tenho uma clínica de estética e queria entender o que é isso.
- Agente: Oi! Sou a assistente da DGC Hub, uma IA, e esta conversa já é a demonstração. 😊 / A gente vende a Recepcionista IA para clínicas, que atende o cliente pelo WhatsApp. / Pra eu te explicar melhor: como a sua clínica recebe os pedidos de horário hoje?
- Clínica: Quanto custa?
- Agente: Para a 1ª clínica parceira temos a condição de piloto: implantação de R$ 990, / em 2 parcelas de R$ 495, e o 1º mês no ar é grátis. / Depois, R$ 690 por mês, mais a taxa do WhatsApp oficial, paga direto à Meta.

### lgpd

- Clínica: E a LGPD, como fica com os dados dos pacientes?
- Agente: Os dados continuam da clínica. A gente só usa nome, telefone e a conversa para marcar e confirmar consulta. / Não pede exame nem prontuário, e quando o paciente fala de saúde a conversa vai para a recepção. / Não usamos os dados para treinar IA nem para outra coisa, e assinamos um termo de LGPD com a clínica.
- Clínica: Me manda o termo de LGPD?
- Agente: Essa eu prefiro que o Gabriel responda direto. Já avisei ele, e ele te responde no horário comercial.  **[transbordo: sensitive_topic]**

### transbordo

- Clínica: Vocês integram com o sistema Feegow?
- Agente: Oi! Sou a assistente da DGC Hub, uma IA, e esta conversa já é a demonstração. 😊 Essa eu prefiro que o Gabriel responda direto. Já avisei ele, e ele te responde no horário comercial.  **[transbordo: Pergunta sobre integração com Feegow, sem informação na base]**
- Clínica: Faz por R$ 500?
- Agente: Essa eu prefiro que o Gabriel responda direto. Já avisei ele, e ele te responde no horário comercial.  **[transbordo: sensitive_topic]**

### log de transbordo

```
{"criadoEm":"2026-11-24T05:19:52.032Z","tenantSlug":"dgc-vendas","conversationId":"cmwu8womz0008ox05qnwja9s2","motivo":"sensitive_topic","resumo":"Clínica: E a LGPD, como fica com os dados dos pacientes?\nAgente: Os dados continuam da clínica. A gente só usa nome, telefone e a conversa para marcar e confirmar consulta. Não pede exame nem prontuário, e quando o paciente fala de saúde a conversa vai para a recepção. Não usamos os dados para treinar IA nem para outra coisa, e assinamos um te…\nClínica: Me manda o termo de LGPD?","respostaRecomendada":"Dizer que o termo de LGPD ainda está com o advogado e que o Gabriel responde. Não prometer prazo."}
{"criadoEm":"2026-11-24T05:19:55.329Z","tenantSlug":"dgc-vendas","conversationId":"cmwu8woo4000fox05jvmi4fx5","motivo":"Pergunta sobre integração com Feegow, sem informação na base","resumo":"Clínica: Vocês integram com o sistema Feegow?","respostaRecomendada":"A pergunta não está na base. O Gabriel lê a conversa e responde direto."}
{"criadoEm":"2026-11-24T05:19:55.341Z","tenantSlug":"dgc-vendas","conversationId":"cmwu8woo4000fox05jvmi4fx5","motivo":"sensitive_topic","resumo":"Clínica: Vocês integram com o sistema Feegow?\nAgente: Oi! Sou a assistente da DGC Hub, uma IA, e esta conversa já é a demonstração. 😊 Essa eu prefiro que o Gabriel responda direto. Já avisei ele, e ele te responde no horário comercial.\nClínica: Faz por R$ 500?","respostaRecomendada":"Manter o preço do piloto da base. Desconto e parcelamento diferente só o Gabriel decide."}
```
