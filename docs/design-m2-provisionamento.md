# Design — M2: signup + provisionamento (config/knowledge no banco)

> Rascunho gerado em trabalho autônomo (2026-07-06, madrugada). **Pontos marcados 🔶 esperam
> decisão do dono** antes de virar produção. O que está sem marca é aditivo e seguro (não toca
> o serviço no ar).

## O gap que M2 resolve
Hoje `TenantConfig` vive em `config/tenants/<slug>.json` e a knowledge em `knowledge/<slug>/` —
**arquivos no working tree**. Um signup HTTP não consegue provisionar um tenant sem escrever
arquivo no host (`tenant-config.ts:150` já antecipa "na Fase 4 vira banco"). Enquanto for
arquivo, self-service é inviável.

## A decisão de arquitetura 🔶 (a que trava tudo)
`loadTenantConfig(slug)` é **síncrono** (`readFileSync`) e é chamado no caminho quente do motor
(`conversation.server.ts` por mensagem) e nas telas. Ler do banco é **async** (Prisma). Três
saídas:

- **A) Tornar `loadTenantConfig` async** e propagar `await` pelos callers (motor + telas). Mais
  limpo a longo prazo; blast radius maior (toca o caminho quente do motor).
- **B) Cache em memória**: carregar todos os configs do banco no boot num Map síncrono, invalidar
  no save. Mantém `loadTenantConfig` síncrono; risco de stale entre instâncias (só 1 hoje).
- **C) Híbrido**: banco como fonte, arquivo como fallback durante a transição; migrar callers aos
  poucos. Mais seguro pra não quebrar o piloto.

**Recomendação:** C para a transição (aditivo, reversível), convergindo pra A. **Decida antes de
eu trocar os callers.**

## Plano em camadas (de baixo risco pra alto)

1. **[seguro, autônomo] Schema aditivo** — models `TenantConfigRecord` (tenantId + json do config)
   e `KnowledgeDoc` (tenantId + título + conteúdo + ordem). Migration aplicada só em banco de
   teste; produção intacta. Espelha M1.1.
2. **[seguro, autônomo] Camada de acesso** — `loadTenantConfigFromDb`/`saveTenantConfigToDb`/
   `writeKnowledgeDoc` (async), **reusando `parseTenantConfig`** (a validação não muda). Com
   testes. NÃO troca nenhum caller ainda.
3. **[seguro, autônomo] `provisionTenant({slug,name,ownerEmail})`** transacional idempotente:
   cria Tenant + config default seguro (`safeDefaultConfig`) + Account owner numa transação.
   Testado contra banco descartável.
4. **[seguro, autônomo] Seed/migração** dos configs de arquivo → banco (script idempotente,
   como o M1.2), rodado só em teste.
5. **🔶 [espera decisão A/B/C] Trocar os callers** do motor/telas pra fonte-banco.
6. **🔶 [espera provedor de e-mail] Rota `/signup`** + verificação de e-mail. O provedor
   (Resend/SES/Postmark) é escolha do dono — a rota fica pronta com o envio stubbed até lá.

## O que faço nesta madrugada
Camadas 1–4 (aditivas, testadas, commitadas — o CI valida cada push). Paro antes da 5 e 6,
que dependem de você. De manhã você revê o design, escolhe A/B/C e o provedor de e-mail, e a
ativação é rápida.
