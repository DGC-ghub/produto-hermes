# Prompt para Claude Code — Produto Hermes Task 14

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido em português simples:

Produto Hermes já tem o MVP simulado funcional e apresentável:

- `/`: home real do produto;
- `/demo/chat`: simulador de conversa;
- `/dashboard`: painel da empresa;
- conversa → resposta → lead → painel já funciona localmente;
- `docs/SECURITY-BACKLOG.md` registra as dívidas obrigatórias antes de produção.

Agora execute somente a Task 14 do plano:

```text
Task 14: Criar notas da integração WhatsApp oficial
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 14:

Criar um documento explicando como o Produto Hermes deve sair do simulador local e caminhar para uma integração real e segura com WhatsApp oficial.

Em português simples: esta task não implementa WhatsApp. Ela documenta o caminho certo para implementar depois, sem atalhos perigosos.

## Escopo exato desta task

Fazer:

1. Criar o arquivo:

```text
docs/whatsapp-oficial-notas.md
```

2. Explicar o caminho futuro com WhatsApp oficial.
3. Amarrar as notas ao `docs/SECURITY-BACKLOG.md`.
4. Explicar que `processIncomingMessage(...)` é o ponto interno natural para reutilizar no webhook futuro.
5. Rodar validações do projeto para garantir que nada quebrou.

Não fazer:

1. Não implementar webhook.
2. Não criar rota de API.
3. Não instalar SDK.
4. Não adicionar variáveis reais no `.env`.
5. Não mexer em banco/schema/migration.
6. Não alterar `/demo/chat`, `/dashboard`, home ou README.
7. Não implementar autenticação agora.
8. Não fazer commit nem push.

## Arquivos esperados

Criar:

```text
docs/whatsapp-oficial-notas.md
```

Também incluir o prompt no commit futuro:

```text
docs/prompts/2026-06-22-task-14-whatsapp-oficial-notas.md
```

## Conteúdo obrigatório do documento

O arquivo `docs/whatsapp-oficial-notas.md` deve conter seções claras em português:

### 1. Título

```md
# WhatsApp Oficial — Notas de Integração
```

### 2. Status atual

Explicar:

- o Produto Hermes está em MVP simulado/local;
- `/demo/chat` simula entrada de mensagem;
- ainda não existe WhatsApp real;
- não usar com dados reais ainda.

### 3. Por que não usar API não oficial

Explicar riscos:

- risco de banimento do número;
- instabilidade;
- quebra de termos da Meta/WhatsApp;
- risco para dados de clientes;
- manutenção imprevisível;
- não combina com produto sério da DGC.

Conclusão: usar caminho oficial.

### 4. Caminhos oficiais possíveis

Explicar duas opções:

1. Meta Cloud API direta;
2. provedor homologado/BSP.

Para cada uma, citar prós e contras em bullets simples.

Exemplo:

Meta Cloud API direta:

- mais controle;
- menos intermediário;
- exige configurar app Meta, webhook, tokens e templates;
- exige mais responsabilidade técnica.

Provedor homologado/BSP:

- onboarding geralmente mais simples;
- suporte operacional;
- pode ter custo adicional;
- pode limitar flexibilidade.

### 5. Arquitetura futura sugerida

Descrever fluxo:

```text
WhatsApp oficial
  -> webhook do Produto Hermes
  -> valida assinatura/origem
  -> resolve tenant
  -> resolve contactId pelo telefone/wa_id oficial
  -> chama processIncomingMessage(...)
  -> envia resposta pela API oficial
  -> salva conversa/mensagens/leads/handoff no banco
```

Explicar que o contrato interno atual:

```ts
processIncomingMessage({ tenantSlug, message, conversationId?, contactId? })
```

é o ponto natural de entrada para reaproveitar a lógica já construída.

Mas no WhatsApp real:

- `contactId` NÃO deve vir do form;
- `contactId` deve vir do `wa_id`/telefone validado no webhook;
- `tenantSlug` deve ser resolvido por número conectado, configuração ou rota segura.

### 6. Segurança obrigatória antes de produção

Referenciar:

```text
docs/SECURITY-BACKLOG.md
```

Listar requisitos obrigatórios:

- autenticação para operadores do dashboard;
- autorização por tenant;
- dashboard protegido;
- validação de assinatura/origem do webhook;
- `contactId` derivado do canal autenticado;
- segredos em variáveis de ambiente;
- logs sem vazar dados sensíveis;
- revisão LGPD antes de dados reais.

### 7. Variáveis de ambiente futuras

Listar nomes placeholder, sem valores reais:

```text
WHATSAPP_PROVIDER=meta_cloud|bsp
WHATSAPP_PHONE_NUMBER_ID=[REDACTED]
WHATSAPP_ACCESS_TOKEN=[REDACTED]
WHATSAPP_VERIFY_TOKEN=[REDACTED]
WHATSAPP_APP_SECRET=[REDACTED]
WHATSAPP_WEBHOOK_URL=[REDACTED]
```

Não colocar token real.

### 8. Templates de mensagem

Explicar:

- WhatsApp exige templates aprovados para iniciar conversa fora da janela permitida;
- respostas dentro da janela de atendimento podem ser mensagens livres conforme regras vigentes;
- templates devem ser curtos, claros e aprováveis;
- exemplos conceituais, sem prometer aprovação.

Incluir 2 exemplos conceituais:

```text
Olá, recebemos sua solicitação sobre {{1}}. Podemos continuar por aqui?
```

```text
Seu atendimento foi encaminhado para uma pessoa do time. Em breve retornaremos por aqui.
```

### 9. Custos e limites

Explicar de forma genérica:

- pode haver cobrança por conversa/mensagem conforme política vigente da Meta/provedor;
- custos mudam com o tempo;
- confirmar preço no momento da integração;
- medir volume antes de prometer preço para cliente.

Não inventar preço.

### 10. Critérios para iniciar integração real

Checklist:

- MVP simulado validado em demo;
- segurança mínima implementada;
- cliente/piloto definido;
- número WhatsApp dedicado definido;
- política LGPD revisada;
- decisão Meta direta vs BSP tomada;
- plano de rollback/manual definido;
- logs e monitoramento mínimos definidos.

### 11. Fora de escopo deste documento

Listar:

- implementação do webhook;
- setup real da Meta;
- compra/validação de número;
- autenticação do dashboard;
- deploy de produção.

Esses itens ficam para fases futuras.

## Regras de qualidade

- Português simples.
- Não prometer que integração é rápida/fácil.
- Não recomendar API não oficial.
- Não colocar credenciais reais.
- Não inventar preços.
- Manter coerência com `docs/SECURITY-BACKLOG.md`.

## Validações obrigatórias

Mesmo sendo só documentação, rode:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Também verificar:

```bash
git status --short
git status --ignored --short | sed -n '1,120p'
```

Confirmar:

- `.env` não aparece no status normal;
- `dev.db` não aparece no status normal;
- `build/`, `generated/`, `.react-router/`, `node_modules/` não entram como tracked.

## Relatório final obrigatório

Responder neste formato:

```text
Status: PASS / FAIL / BLOCKED

Arquivos alterados:
- ...

Validações:
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL
- npm run build: PASS/FAIL

Conteúdo implementado:
- status atual MVP simulado
- por que não usar API não oficial
- caminhos oficiais Meta/BSP
- arquitetura futura
- segurança obrigatória
- variáveis futuras sem segredo real
- templates
- custos sem inventar preço
- critérios para integração real

Banco local/git:
- .env/dev.db aparecem no git status normal? SIM/NÃO
- arquivos ignorados relevantes

Observações:
- ...

Próximo passo recomendado:
- Task 15: validação completa final
```

Lembrete: não commitar, não dar push, não implementar Task 15.
