# Plano de manutenção — Hermes

## Versões-chave (12/11/2026)
- react-router / @react-router/* 8.5.1, compression 1.8.2, prisma / @prisma/client 7.10.1
- `@biomejs/biome` fixado em 2.5.0 (sem `^`), para o lint não mudar sozinho.
- `npm audit`: 0 avisos. Refazer a cada atualização.

## Obrigatório antes de publicar (deploy)
1. **Origem de formulário atrás de proxy HTTPS.** React Router 8.3+ rejeita POST de formulário com
   `Origin: https://...` quando o TLS termina no proxy. Se o deploy usar proxy HTTPS, defina no
   **build** `HERMES_ALLOWED_ACTION_ORIGINS` com o domínio público (lista separada por vírgula;
   lido em `react-router.config.ts`). Sem a variável, vale o padrão seguro.
   Teste de fumaça obrigatório: enviar um formulário pelo domínio público e ver que grava.
   (No Docker, a variável tem que estar disponível no estágio de build.)
2. Itens de `docs/SECURITY-BACKLOG.md` (auth, tenant, LGPD).

Hoje (12/11/2026) o Hermes não roda em produção, então o item 1 ainda não foi testado com proxy real.

## Rotina
- Clone novo: criar `.env` e rodar `npx prisma migrate deploy` antes de `npm test` (sem isso 13 testes falham).
- `npm run eval:gate` usa cota do modelo (~26 min): só com aval dos sócios.
