# Demo do opt-in (DGC-348)

O opt-in fica **atrás de uma flag por tenant**: `"optIn": { "enabled": true, "limiteDiario": 100 }`
em `config/tenants/<slug>.json` (ou no config do banco). Sem a flag (padrão), a conversa é igual
à do vídeo gravado (DGC-182/185): nada muda. Só vale em modo `whatsapp` (efeitos reais).

## Passo a passo (tenant com a flag ligada)
1. Peça uma consulta: "quero a limpeza dia 18 às 8h". A resposta confirma a consulta e **depois** pergunta:
   "Quer receber lembretes e novidades da clínica por aqui? Responda SIM ou NÃO."
2. Responda "sim" (ou "pode", "prefiro não"...). A Recepcionista agradece, sem chamar a IA.
3. Abra `/atendente?contactId=<contato>`: o painel mostra o selo **"Aceitou lembretes em DD/MM"**.
4. Escreva "PARAR": o selo vira "Recusou lembretes em DD/MM".

Regras: pergunta uma vez só; nunca antes de resolver o pedido; nunca em transbordo.
Dados: tabela `ContactOptIn` (status sim/nao/vazio, data, id da mensagem de origem). A exclusão LGPD
por contato e por empresa apaga o registro.
