# CI do Hermes

Arquivo: `.github/workflows/ci.yml`. Roda em todo push e PR, em runner gratuito do GitHub.

| Job | O que faz | Bloqueia o merge? |
|---|---|---|
| `check` | typecheck, testes (vitest) e lint (biome) | Fica vermelho; bloqueia quando a protecao da `main` exigir o check |
| `secrets` | gitleaks no codigo e no historico, com `--redact` | Fica vermelho; bloqueia quando a protecao da `main` exigir o check |
| auditoria (passo do `check`) | `npm audit --omit=dev --audit-level=high` | Nao (`continue-on-error`) |

`concurrency` cancela a rodada antiga da mesma branch.

## Rodar na VM trabalhadora
- Uma bateria por vez por pasta: dois `npm test` na mesma pasta quebram os testes (usam o mesmo `.test.db`).
- `npm run typecheck && npm run lint && npm test`

## Se o gitleaks reclamar
1. Veja arquivo e linha no log (o valor vem mascarado).
2. Se for segredo real: nao basta apagar. Avise o Arquiteto: o segredo precisa ser trocado (aval dos socios) e depois sai do historico.
3. Se for falso positivo (exemplo no `.env.example`, hash de teste): adicione o fingerprint (linha do log) ao `.gitleaksignore`, ou crie `.gitleaks.toml` com `[allowlist]` e o caminho/regex exato, em PR.

## Pendencias
- Tirar o `continue-on-error` da auditoria quando a lista estiver limpa.
- `eval.yml` (manual) gasta chamada de modelo: fica de fora ate os socios decidirem.
- Ligar a protecao da `main` exigindo `check` e `secrets` (precisa do ok dos socios).
