#!/usr/bin/env bash
# Backup diário do Postgres (chatwoot + evolution). Guarda 7 dias.
# Uso: scripts/backup.sh        (usa PI_DEST=usuario@host:~/backups/chatwoot/ se definido, via rsync/ssh)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="${COMPOSE_ENV:-$HOME/.config/dgc-atendimento/compose.env}"
OUT="${BACKUP_DIR:-$HOME/backups/chatwoot}"
KEEP_DAYS="${KEEP_DAYS:-7}"
mkdir -p "$OUT"; chmod 700 "$OUT"
STAMP="$(date +%Y%m%d-%H%M%S)"
DC=(sudo docker compose --env-file "$ENVF" -f "$DIR/docker-compose.yml")
for DB in chatwoot evolution; do
  F="$OUT/${DB}-${STAMP}.sql.gz"
  "${DC[@]}" exec -T postgres pg_dump -U postgres --clean --if-exists "$DB" | gzip -9 > "$F.tmp"
  gzip -t "$F.tmp"; mv "$F.tmp" "$F"; chmod 600 "$F"
  echo "ok: $F ($(du -h "$F" | cut -f1))"
done
find "$OUT" -name '*.sql.gz' -mtime +"$((KEEP_DAYS-1))" -delete
if [ -n "${PI_DEST:-}" ]; then
  rsync -a --delete -e "ssh -o BatchMode=yes" "$OUT"/ "$PI_DEST" && echo "ok: copiado para a Pi"
else
  echo "aviso: PI_DEST não definido; cópia só nesta VM" >&2
fi
