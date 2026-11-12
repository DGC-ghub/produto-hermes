#!/usr/bin/env bash
# Backup diário do banco do Hermes (SQLite) — pra FORA da working tree.
# Motivo: dev.db é cópia única e um `git clean -fdx` levaria o banco junto
# (bloqueio S5 do docs/plano-entrega-2026.md). Roda no cron do usuário pi.
# O .env NÃO entra no backup (segredos ficam no cofre dos sócios — DGC-92/M4).
# Off-site: backups com mais de $RETENTION_DAYS dias saem do remoto (LGPD, termo 5.3).
set -euo pipefail

DEFAULT_DB="/home/pi/projects/produto-hermes/dev.db"
# O .env é só LIDO, para achar o caminho do banco (DATABASE_URL). Nunca é copiado nem impresso.
ENV_FILE="${HERMES_ENV_FILE:-/home/pi/projects/produto-hermes/.env}"
DEST="${HERMES_BACKUP_DEST:-/home/pi/backups/hermes}"
KEEP=14
RETENTION_DAYS="${HERMES_BACKUP_RETENTION_DAYS:-90}"

# Caminho do banco = o mesmo do DATABASE_URL do serviço (evita backup do arquivo errado).
DB="${HERMES_DB:-}"
if [ -z "$DB" ]; then
  url="${DATABASE_URL:-}"
  if [ -z "$url" ] && [ -r "$ENV_FILE" ]; then
    url="$(grep -E '^[[:space:]]*DATABASE_URL=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d "\"'" || true)"
  fi
  case "$url" in
    file:/*) DB="${url#file:}"; DB="${DB%%\?*}" ;;
    *)       DB="$DEFAULT_DB" ;;
  esac
fi
[ -f "$DB" ] || { echo "[backup-hermes] banco não encontrado: $DB" >&2; exit 1; }

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

chmod 600 "$out"

# Rotação: mantém os $KEEP mais recentes.
ls -1t "$DEST"/dev-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
# Legado: env-*.bak de versões antigas do script tinham segredos; não geramos mais, e removemos.
rm -f "$DEST"/env-*.bak

# ── Off-site (marco M0.4): sobe pro remote rclone CIFRADO, se configurado ─────
# Backup no MESMO disco não protege contra falha de disco / roubo / perda do Pi.
# O remote deve ser um `crypt` do rclone (cifra em repouso) — configurar uma vez
# com `rclone config` (passo a passo em deploy/backup-offsite.md). Enquanto não
# existir, o backup LOCAL segue funcionando normalmente; só registra que pulou.
REMOTE="${HERMES_BACKUP_REMOTE:-hermes-crypt:}"
# (listremotes vai pra variável: com pipefail, `| grep -q` podia dar SIGPIPE e pular o off-site à toa)
remotes="$(rclone listremotes 2>/dev/null || true)"
if command -v rclone >/dev/null 2>&1 && grep -qx "${REMOTE%%:*}:" <<<"$remotes"; then
  if rclone copy "$DEST" "$REMOTE" --include 'dev-*.db'; then
    echo "[backup-hermes] off-site ok: enviado pra $REMOTE (cifrado)"
    # Prazo de guarda (LGPD 5.3): só roda se a cópia deu certo. O filtro limita o delete
    # aos arquivos de backup do Hermes (dev-*.db e env-*.bak legado); $REMOTE é o remote
    # do Hermes (crypt apontando pra pasta dedicada), nunca a raiz de um bucket compartilhado.
    if rclone delete "$REMOTE" --min-age "${RETENTION_DAYS}d" --include 'dev-*.db' --include 'env-*.bak'; then
      echo "[backup-hermes] off-site retenção ok: removidos backups com mais de ${RETENTION_DAYS} dias"
    else
      echo "[backup-hermes] off-site retenção FALHOU (rclone delete)" >&2
    fi
  else
    echo "[backup-hermes] off-site FALHOU (rclone copy) — backup local preservado" >&2
  fi
else
  echo "[backup-hermes] off-site PULADO: remote '$REMOTE' não configurado (ver deploy/backup-offsite.md)"
fi

echo "[backup-hermes] ok: $out ($(stat -c%s "$out") bytes, integrity ok)"
