#!/usr/bin/env bash
# Backup diário do banco do Hermes (SQLite) + .env — pra FORA da working tree.
# Motivo: dev.db é cópia única e um `git clean -fdx` levaria banco E .env juntos
# (bloqueio S5 do docs/plano-entrega-2026.md). Roda no cron do usuário pi.
set -euo pipefail

DB="/home/pi/projects/produto-hermes/dev.db"
ENV_FILE="/home/pi/projects/produto-hermes/.env"
DEST="/home/pi/backups/hermes"
KEEP=14

mkdir -p "$DEST"
chmod 700 "$DEST"

stamp="$(date +%Y%m%d-%H%M%S)"
out="$DEST/dev-$stamp.db"

# .backup (não cp): snapshot consistente mesmo com o serviço escrevendo.
sqlite3 "$DB" ".backup '$out'"

# Restore-test de verdade: o backup abre e passa no integrity_check?
check="$(sqlite3 "$out" 'PRAGMA integrity_check;')"
if [ "$check" != "ok" ]; then
  echo "[backup-hermes] FALHOU integrity_check: $check" >&2
  rm -f "$out"
  exit 1
fi

# .env junto (token da Meta, segredos) — sem ele o restore não sobe o serviço.
cp "$ENV_FILE" "$DEST/env-$stamp.bak"
chmod 600 "$out" "$DEST/env-$stamp.bak"

# Rotação: mantém os $KEEP mais recentes de cada tipo.
ls -1t "$DEST"/dev-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$DEST"/env-*.bak 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[backup-hermes] ok: $out ($(stat -c%s "$out") bytes, integrity ok)"
