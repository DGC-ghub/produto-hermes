# Tenant `dgc-vendas` na demo (DGC-265)

O que é: o agente de vendas da DGC no chat web da demo, antes de o número da DGC existir.

**Link (só na tailnet):** `https://trabalhadora.tail04b4ef.ts.net:10000/demo/chat?tenant=dgc-vendas`. Nunca com Funnel.

## Como funciona
- Base única: `knowledge/dgc-vendas/base_agente_vendas.md` (cópia de `docs/comercial/BASE_AGENTE_VENDAS.md`, DGC-264).
- Config: `config/tenants/dgc-vendas.json`. É tudo configuração, sem código por cliente.
- **Preço em texto fixo** (`fixedReplies`): o balcão responde sem chamar a IA. Teste confere que o texto é o da base, palavra por palavra.
- **Transbordo** (`escalationPolicy.triggers` + o cérebro quando a base não cobre): avisa a clínica e grava uma linha em `data/transbordos/dgc-vendas.jsonl` (ou `HERMES_TRANSBORDO_DIR`) com resumo e resposta recomendada. Cartão no Paperclip fica para a tarefa do canal.
- CPF, e-mail e telefone saem do log (`ocultarDadosPessoais`).
- Modo `public_demo`: sem agenda, WhatsApp, lead nem chamado. Provedor continua `claude_cli` (sem gasto novo).

## Testar em 3 passos
1. Abra o link acima.
2. Escreva "Quanto custa?" e confira o texto do piloto.
3. Escreva "Me manda o termo de LGPD?" e veja o aviso do Gabriel; confira o log em `data/transbordos/`.

## Fica de fora / risco
- Dado de paciente: só pega palavras (cpf, exame, prontuário...). Nome de paciente sem palavra-chave depende da regra no prompt.
- A frase de aviso diz "no horário comercial". A base pede "até [hora]": o horário vem do cartão, na tarefa do canal.
- A base está como rascunho (DGC-264); ao mudar, copie o arquivo inteiro e rode os testes.
