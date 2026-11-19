#!/usr/bin/env bash
# Restaura o backup mais recente do chatwoot num banco temporário e confere as tabelas. Não toca no banco real.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="${COMPOSE_ENV:-$HOME/.config/dgc-atendimento/compose.env}"
OUT="${BACKUP_DIR:-$HOME/backups/chatwoot}"
F="$(ls -1t "$OUT"/chatwoot-*.sql.gz | head -1)"
DC=(sudo docker compose --env-file "$ENVF" -f "$DIR/docker-compose.yml")
PSQL=("${DC[@]}" exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -q)
echo "arquivo: $F"
"${PSQL[@]}" -c "DROP DATABASE IF EXISTS restore_teste;" -c "CREATE DATABASE restore_teste;"
gunzip -c "$F" | "${DC[@]}" exec -T postgres psql -U postgres -d restore_teste -q -v ON_ERROR_STOP=0 >/dev/null 2>"${TMPDIR:-/tmp}/restore.err" || true
N=$("${DC[@]}" exec -T postgres psql -U postgres -d restore_teste -tAc "select count(*) from information_schema.tables where table_schema='public';")
U=$("${DC[@]}" exec -T postgres psql -U postgres -d restore_teste -tAc "select count(*) from users;")
"${PSQL[@]}" -c "DROP DATABASE restore_teste;"
echo "tabelas restauradas: $N | usuários: $U"
[ "$N" -gt 50 ] && echo "RESTAURAÇÃO OK" || { echo "FALHOU"; exit 1; }
