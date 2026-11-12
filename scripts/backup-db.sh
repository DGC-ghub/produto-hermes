#!/usr/bin/env bash
# Backup diário do banco do Hermes (SQLite) — pra FORA da working tree.
# Motivo: dev.db é cópia única e um `git clean -fdx` levaria o banco junto
# (bloqueio S5 do docs/plano-entrega-2026.md). Roda no cron do usuário pi.
# O .env NÃO entra no backup (segredos ficam no cofre dos sócios — DGC-92/M4).
# Off-site: backups com mais de $RETENTION_DAYS dias saem do remoto (LGPD, termo 5.3).
set -euo pipefail

DEFAULT_DB="/home/pi/projects/produto-hermes/dev.db"
# O .env é só LIDO, para achar o caminho do banco (DATABASE_URL). Nunca é copiado nem impresso.
# Padrão = o .env do release em uso (o serviço roda de hermes-deploy/current, deploy/hermes.service);
# se não existir, cai para o da working tree.
RELEASE_ENV="/home/pi/hermes-deploy/current/.env"
TREE_ENV="/home/pi/projects/produto-hermes/.env"
if [ -n "${HERMES_ENV_FILE:-}" ]; then
  ENV_FILE="$HERMES_ENV_FILE"
elif [ -e "$RELEASE_ENV" ]; then
  ENV_FILE="$RELEASE_ENV"
else
  ENV_FILE="$TREE_ENV"
fi
DEST="${HERMES_BACKUP_DEST:-/home/pi/backups/hermes}"
KEEP=14
RETENTION_DAYS="${HERMES_BACKUP_RETENTION_DAYS:-90}"
rc=0

# Caminho do banco = o mesmo do DATABASE_URL do serviço (evita backup do arquivo errado).
# Falha fechado: DATABASE_URL presente mas não absoluto (file:/...) aborta, sem cair no padrão.
DB="${HERMES_DB:-}"; DB_SRC="HERMES_DB"
if [ -z "$DB" ]; then
  url="${DATABASE_URL:-}"; DB_SRC="DATABASE_URL do ambiente"
  if [ -z "$url" ] && [ -r "$ENV_FILE" ]; then
    url="$(grep -E '^[[:space:]]*DATABASE_URL=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d "\"'" || true)"
    DB_SRC="DATABASE_URL de $ENV_FILE"
  fi
  case "$url" in
    file:/*) DB="${url#file:}"; DB="${DB%%\?*}" ;;
    "")      DB="$DEFAULT_DB"; DB_SRC="caminho padrão (sem DATABASE_URL)" ;;
    *)       echo "[backup-hermes] FALHOU: DATABASE_URL não é um caminho absoluto (file:/...); não vou adivinhar o banco" >&2; exit 1 ;;
  esac
fi
[ -f "$DB" ] || { echo "[backup-hermes] banco não encontrado: $DB (origem: $DB_SRC)" >&2; exit 1; }
echo "[backup-hermes] banco: $DB (origem: $DB_SRC)"

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
      echo "[backup-hermes] off-site retenção FALHOU (rclone delete) — prazo de 90 dias NÃO aplicado" >&2
      rc=1
    fi
  else
    echo "[backup-hermes] off-site FALHOU (rclone copy) — backup local preservado" >&2
  fi
else
  echo "[backup-hermes] off-site PULADO: remote '$REMOTE' não configurado (ver deploy/backup-offsite.md)"
fi

echo "[backup-hermes] ok: $out ($(stat -c%s "$out") bytes, integrity ok)"
exit "$rc"
