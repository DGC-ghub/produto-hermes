# Security Backlog — Produto Hermes

## Contexto

O Produto Hermes está em fase de **MVP simulado/local**, sem WhatsApp real, sem
usuários reais e sem dados reais de clientes.

As rotas atuais, incluindo `/demo/chat`, são **públicas dentro do ambiente local
de desenvolvimento**. Isso é aceitável para demo local, mas **NÃO** é aceitável
para produção ou uso com dados reais.

## Já implementado

**Auth multi-tenant (2026-06-25)** — modelo `Operator` no banco (username + senha
com hash scrypt nativo, salt por senha; `app/lib/operators.server.ts`). Login por
usuário+senha; a sessão carrega o tenant do operador e **todas** as leituras
internas (fila, dossiê, dashboard) são escopadas por ele. Cada empresa só vê os
próprios clientes — o IDOR cross-tenant do operador (item 4) está **fechado**
(provado por curl: operador `dgc` não acessa o dossiê de um contato da `assistencia`).

**Gate de operador (2026-06-24)** — `/atendente` e `/dashboard` exigem login;
cookie de sessão assinado (`SESSION_SECRET`, httpOnly, `secure` em prod,
fail-closed). Redirect protegido contra open-redirect.

**Isolamento por contato no motor** — o LLM e as queries de chamado/lead operam
por `(tenantId, contactId)`; um contato nunca vê dados de outro.

> ⚠️ Ainda pendente: `contactId` vem do form no simulador (item 3 — resolve no
> WhatsApp real) e não há tela de gestão de operadores (hoje criados via seed).

## Itens obrigatórios antes de produção

### 1. Broken Access Control / IDOR

Hoje qualquer pessoa que acesse o simulador local pode ver conversas do tenant
selecionado.

Mitigação futura:

- adicionar autenticação;
- adicionar autorização por usuário/papel;
- garantir que um operador só acesse conversas do tenant permitido;
- validar acesso por `conversationId` sempre com tenant + usuário autorizado.

**Status:** ✅ **resolvido** no MVP — acesso anônimo fechado pelo gate e autorização
por tenant do operador implementada (item 4). Falta só `conversationId` confiável do
canal autenticado (item 3, no WhatsApp real).

### 2. Information Disclosure / Missing Authorization

O dashboard/listagem de conversas não deve ser público quando houver dados reais.

Mitigação futura:

- proteger `/dashboard` com login;
- exigir sessão autenticada;
- filtrar dados por tenant autorizado;
- nunca expor conversas reais sem autorização.

**Status:** ✅ **resolvido** — `/dashboard` exige login e `getDashboardData` filtra
todos os números pelo tenant do operador.

### 3. Identity Spoofing / Audit Integrity

Hoje `contactId` pode vir do form porque o simulador representa os dois lados da
conversa.

Mitigação futura:

- em WhatsApp real, `contactId` deve vir do canal autenticado/webhook;
- não aceitar identidade do contato vinda do cliente/form;
- registrar origem da mensagem de forma confiável;
- proteger auditoria de `Message`/`HandoffEvent` contra autoria forjada.

**Status:** dívida conhecida, não bloqueia MVP local.

### 4. Cross-tenant pelo operador (IDOR na tela do atendente)

O gate é uma **senha única de operador**, sem modelo de usuário/tenant. Um
operador logado pode ver o dossiê de **qualquer** `(tenant, contactId)` em
`/atendente?tenant=…&contactId=…` (a `getContactDossier` aceita os parâmetros da
query sem amarrá-los ao operador), e a fila (`getHandoffQueue`) mistura todos os
tenants.

Mitigação futura (fase de auth multi-tenant):

- modelo de **operador → tenant(s)** permitidos;
- `getHandoffQueue`/`getContactDossier` recebem o `tenantId` da sessão e filtram por ele;
- rejeitar `tenant` da query que não pertença ao operador.

**Status:** ✅ **resolvido (2026-06-25).** Modelo `Operator` (username + senha com
hash scrypt) com `tenantId`; a sessão carrega o tenant e `getHandoffQueue`,
`getContactDossier` e `getDashboardData` filtram por ele. `/atendente` não lê mais
o tenant da query — vem da sessão. Falta apenas uma tela de gestão de operadores
(hoje há um por empresa, via seed).

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
