# Plano de manutenção do Hermes

Atualizado em 2026-11-12 (DGC-89). Fonte: `package.json`, `Dockerfile`, CI, `npm outdated` e `npm audit --omit=dev`.
Este documento só descreve; nenhuma dependência foi alterada aqui.

## Runtime
| Item | Versão | Obs. |
|---|---|---|
| Node na VM | 24.22.0 | Dockerfile usa `node:24-alpine` |
| Node no CI | 22 | Diverge da imagem Docker (24) |
| @types/node | 22.x | combina com o CI, não com o Docker |

## O que está velho (atual -> disponível)
- Pequenas/patch (baixo risco): biome 2.5.0->2.6.7, tailwind e @tailwindcss/vite 4.3.1->4.3.5, vite 8.0.16->8.3.8, vitest 4.1.9->4.1.12, express 5.2.1->5.3.0, isbot 5.1.43->5.2.3, react/react-dom 19.2.7->19.3.1, jsdom 30.0.1->30.1.3, testing-library, @types/*, baileys 7.0.0-rc13->rc14.
- Maiores (um PR cada): better-sqlite3 12->13, dotenv 17->18, typescript 5.9->7.0, vitest 4->5, jsdom 31.
- Já cobertos pela DGC-93 (branch `chore/deps-seguranca-a4`): react-router 8.5.1, compression 1.8.2, prisma 7.10.1 e `npm audit fix`.

## Vulnerabilidades (`npm audit --omit=dev`, antes da DGC-93): 20 (1 crítica, 12 altas, 7 moderadas)
- Crítica: `proxy-addr` (transitiva do express).
- Altas sem quebra: body-parser, compression, fast-uri, sharp.
- Altas via react-router: resolvidas em 8.5.1.
- Via prisma (toolchain `@prisma/dev`, impacto provável baixo em runtime): resolvidas em 7.10.1.
- Moderadas: qs, morgan, music-metadata, hono.
Reexecutar `npm audit --omit=dev` depois que a DGC-93 entrar em `main`.

## O que vence
- Token do WhatsApp (Meta): o temporário vence; ver `docs/whatsapp-token-permanente.md` (conferir se foi criado o permanente).
- Segredos por env: `SESSION_SECRET`, `SECRETS_ENCRYPTION_KEY` (trocar sem plano quebra dados cifrados), `MP_ACCESS_TOKEN`, `RESEND_API_KEY`, `METRICS_TOKEN`, `ALARM_WEBHOOK_URL`. Falta calendário de rotação (decisão dos sócios).
- Baileys: versão rc de biblioteca não oficial; o protocolo muda sem aviso.
- Node 22 sai de suporte em abril/2027.
- Domínio/certificado: ver `docs/dominio-setup.md` (data não verificada).

## O que quebra fácil
1. Baileys (sessão WhatsApp, rc, não oficial).
2. Prisma + better-sqlite3 (binários nativos, versões fixas; trocar de Node exige rebuild).
3. SQLite em WAL: sem backup verificado.
4. Testes dependem do binário `sqlite3`; duas rodadas ao mesmo tempo na mesma pasta podem colidir (ver fix `fix/vitest-db-por-rodada`).
5. CI em Node 22 vs Docker em 24.

## Ordem de atualizações seguras
1. DGC-93: audit fix + react-router + prisma + compression (já em branch).
2. Lote de versões pequenas de dev (biome, vitest, vite, tailwind, testing-library, @types).
3. react/react-dom 19.3.1.
4. express 5.3.0.
5. baileys rc14 (PR próprio; teste manual de sessão pelos sócios).
6. Alinhar Node do CI e do Docker (decisão do Arquiteto).
Não fazer agora: typescript 7, vitest 5, better-sqlite3 13, dotenv 18.

## Regras
- Versão maior: um PR por dependência, com changelog lido. Segurança e patch: pode ser em lote.
- Suíte inteira na VM antes do PR; uma bateria por vez.
- Sem deploy: produção passa pelo aval dos sócios.
