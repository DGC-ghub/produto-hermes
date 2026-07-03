# WhatsApp Oficial — Notas de Integração

> Este documento **não implementa** WhatsApp. Ele descreve o caminho certo para
> integrar depois, sem atalhos perigosos. A implementação fica para fases futuras.

## 1. Status atual

- O Produto Hermes está em **MVP simulado / local**.
- `/demo/chat` **simula** a entrada de uma mensagem (você digita como se fosse o
  cliente); não há mensagem real chegando de fora.
- **Ainda não existe WhatsApp real** conectado.
- **Não usar com dados reais** enquanto não houver segurança e canal oficial.

## 2. Por que não usar API não oficial

Bibliotecas/serviços não oficiais (que automatizam o WhatsApp por engenharia
reversa) **não devem ser usados**:

- **Risco de banimento** do número, a qualquer momento e sem aviso.
- **Instabilidade**: quebram quando o WhatsApp muda algo do lado deles.
- **Quebra dos termos** da Meta/WhatsApp.
- **Risco para os dados dos clientes** (canal não confiável).
- **Manutenção imprevisível**: viram dívida técnica constante.
- **Não combinam com um produto sério** da DGC Hub.

**Conclusão:** usar apenas o caminho **oficial**.

## 3. Caminhos oficiais possíveis

### Opção A — Meta Cloud API direta

- Mais controle sobre o fluxo e os dados.
- Menos intermediário (sem markup de terceiro).
- Exige configurar app na Meta, webhook, tokens e templates.
- Exige mais responsabilidade técnica (você cuida de tudo).

### Opção B — Provedor homologado / BSP

- Onboarding geralmente mais simples.
- Suporte operacional de quem já fez isso.
- Pode ter **custo adicional** (camada do provedor).
- Pode **limitar flexibilidade** (você fica no que a plataforma oferece).

> A escolha entre A e B é uma decisão de produto/operação, não só técnica.
> Decidir antes de iniciar a integração real (ver seção 10).

## 4. Arquitetura futura sugerida

Fluxo esperado quando houver WhatsApp oficial:

```text
WhatsApp oficial
  -> webhook do Produto Hermes
  -> valida assinatura/origem (App Secret / verify token)
  -> resolve tenant (por número conectado / configuração)
  -> resolve contactId pelo telefone/wa_id oficial validado
  -> chama processIncomingMessage(...)
  -> envia resposta pela API oficial
  -> salva conversa/mensagens/leads/handoff no banco
```

### Ponto de entrada interno já pronto

A lógica do "cérebro" já está isolada na função:

```ts
processIncomingMessage({ tenantSlug, message, conversationId?, contactId? })
```

Ela já garante tenant, cria/reutiliza conversa, salva mensagens, faz retrieval,
decide handoff, compõe resposta e extrai lead. **O webhook futuro deve reutilizar
essa função** em vez de reimplementar o fluxo.

### O que muda no WhatsApp real (importante)

- `contactId` **NÃO** deve vir do form/cliente.
- `contactId` deve vir do **`wa_id`/telefone validado no webhook**.
- `tenantSlug` deve ser **resolvido pelo número conectado**, configuração ou rota
  segura — nunca confiando em valor enviado pelo cliente.

Isso fecha diretamente o item de **Identity Spoofing / Audit Integrity** do
backlog de segurança.

## 5. Segurança obrigatória antes de produção

Estas notas seguem e dependem de [`SECURITY-BACKLOG.md`](SECURITY-BACKLOG.md).
Antes de qualquer uso com dado real:

- **Autenticação** para os operadores do dashboard.
- **Autorização por tenant** (cada operador só vê o que pode).
- **Dashboard protegido** (nada público com dado real).
- **Validação de assinatura/origem do webhook** (App Secret + verify token).
- **`contactId` derivado do canal autenticado** (wa_id), não do form.
- **Segredos em variáveis de ambiente** (nunca no código/repo).
- **Logs sem vazar dados sensíveis** (sem PII em texto puro).
- **Revisão LGPD** antes de tratar dados reais de clientes.

## 6. Variáveis de ambiente futuras

Apenas **nomes placeholder** — sem valores reais, sem credenciais no repo:

```text
WHATSAPP_PROVIDER=meta_cloud|bsp
WHATSAPP_PHONE_NUMBER_ID=[REDACTED]
WHATSAPP_ACCESS_TOKEN=[REDACTED]
WHATSAPP_VERIFY_TOKEN=[REDACTED]
WHATSAPP_APP_SECRET=[REDACTED]
WHATSAPP_WEBHOOK_URL=[REDACTED]
```

Quando a integração começar, esses valores ficam no `.env` (ignorado pelo git),
nunca commitados.

## 7. Templates de mensagem

- O WhatsApp exige **templates aprovados** para **iniciar** conversa fora da
  janela de atendimento permitida.
- **Dentro** da janela de atendimento, respostas podem ser mensagens livres,
  conforme as regras vigentes.
- Templates devem ser **curtos, claros e aprováveis**.
- Os exemplos abaixo são **conceituais** — não há garantia de aprovação.

Exemplos conceituais:

```text
Olá, recebemos sua solicitação sobre {{1}}. Podemos continuar por aqui?
```

```text
Seu atendimento foi encaminhado para uma pessoa do time. Em breve retornaremos por aqui.
```

## 8. Custos e limites

- Pode haver **cobrança por conversa/mensagem**, conforme a política vigente da
  Meta/provedor.
- Os **custos mudam com o tempo** — não há preço fixo a assumir aqui.
- **Confirmar o preço no momento da integração**, na fonte oficial.
- **Medir volume** (mensagens/conversas esperadas) antes de prometer preço ao
  cliente.

> Não inventar preço. Não prometer custo sem confirmar na fonte oficial.

## 9. Critérios para iniciar a integração real

Checklist (todos devem estar OK antes de começar):

- [ ] MVP simulado validado em demo.
- [ ] Segurança mínima implementada (ver seção 5).
- [ ] Cliente/piloto definido.
- [ ] Número de WhatsApp dedicado definido.
- [ ] Política LGPD revisada.
- [ ] Decisão Meta direta vs BSP tomada.
- [ ] Plano de rollback/manual definido.
- [ ] Logs e monitoramento mínimos definidos.

## 10. Fora de escopo deste documento

Ficam para fases futuras (não fazem parte destas notas):

- Implementação do webhook.
- Setup real na Meta.
- Compra/validação do número.
- Autenticação do dashboard.
- Deploy de produção.

## 11. Resumo

A integração com WhatsApp **não é rápida nem trivial**. O caminho certo é:
validar o MVP simulado, implementar a segurança obrigatória do backlog, escolher
o canal oficial (Meta direta ou BSP) e só então conectar um webhook que reutiliza
`processIncomingMessage(...)` — com `contactId`/`tenant` resolvidos de forma
confiável pelo canal autenticado.
