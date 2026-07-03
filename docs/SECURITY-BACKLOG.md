# Security Backlog — Produto Hermes

## Contexto

O Produto Hermes está em fase de **MVP simulado/local**, sem WhatsApp real, sem
usuários reais e sem dados reais de clientes.

As rotas atuais, incluindo `/demo/chat` e o futuro `/dashboard`, são **públicas
dentro do ambiente local de desenvolvimento**. Isso é aceitável para demo local,
mas **NÃO** é aceitável para produção ou uso com dados reais.

## Itens obrigatórios antes de produção

### 1. Broken Access Control / IDOR

Hoje qualquer pessoa que acesse o simulador local pode ver conversas do tenant
selecionado.

Mitigação futura:

- adicionar autenticação;
- adicionar autorização por usuário/papel;
- garantir que um operador só acesse conversas do tenant permitido;
- validar acesso por `conversationId` sempre com tenant + usuário autorizado.

**Status:** dívida conhecida, não bloqueia MVP local.

### 2. Information Disclosure / Missing Authorization

O dashboard/listagem de conversas não deve ser público quando houver dados reais.

Mitigação futura:

- proteger `/dashboard` com login;
- exigir sessão autenticada;
- filtrar dados por tenant autorizado;
- nunca expor conversas reais sem autorização.

**Status:** dívida conhecida, não bloqueia MVP local.

### 3. Identity Spoofing / Audit Integrity

Hoje `contactId` pode vir do form porque o simulador representa os dois lados da
conversa.

Mitigação futura:

- em WhatsApp real, `contactId` deve vir do canal autenticado/webhook;
- não aceitar identidade do contato vinda do cliente/form;
- registrar origem da mensagem de forma confiável;
- proteger auditoria de `Message`/`HandoffEvent` contra autoria forjada.

**Status:** dívida conhecida, não bloqueia MVP local.

## Regra de corte

Antes de qualquer deploy com cliente real, WhatsApp real ou dado pessoal real:

- autenticação obrigatória;
- autorização por tenant obrigatória;
- `contactId` derivado do canal autenticado;
- dashboard protegido;
- revisão LGPD/segurança.

## Decisão atual

Não implementar essas proteções agora porque:

- o escopo atual é MVP simulado/local;
- não há dados reais;
- auth e identidade real pertencem à fase de produtização/WhatsApp oficial.
