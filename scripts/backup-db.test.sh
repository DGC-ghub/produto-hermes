#!/usr/bin/env bash
# Teste do backup-db.sh com remote rclone LOCAL (backend `local`) e dados fictícios.
# Uso: scripts/backup-db.test.sh   (precisa de sqlite3 e rclone no PATH)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export RCLONE_CONFIG="$T/rclone.conf"
printf '[fake]\ntype = alias\nremote = %s\n' "$T/remoto" > "$RCLONE_CONFIG"
mkdir -p "$T/remoto"
sqlite3 "$T/app.db" "create table t(x); insert into t values ('VALOR_UNICO_$$');"
printf 'SEGREDO_FICTICIO=abc123\nDATABASE_URL="file:%s"\n' "$T/app.db" > "$T/.env"
# remoto já tem: um backup velho (100d), um recente (10d), um env legado velho e um arquivo alheio velho
touch -d '100 days ago' "$T/remoto/dev-20200101-000000.db" "$T/remoto/env-20200101-000000.bak" "$T/remoto/outra-coisa.txt"
touch -d '10 days ago' "$T/remoto/dev-20200301-000000.db"

env -u DATABASE_URL HERMES_ENV_FILE="$T/.env" HERMES_BACKUP_DEST="$T/local" HERMES_BACKUP_REMOTE="fake:" \
  bash "$HERE/backup-db.sh"

fail=0
chk() { if eval "$2"; then echo "OK   $1"; else echo "FALHA $1"; fail=1; fi; }
chk "backup com >90 dias saiu do remoto" "[ ! -e '$T/remoto/dev-20200101-000000.db' ]"
chk "env legado velho saiu do remoto"    "[ ! -e '$T/remoto/env-20200101-000000.bak' ]"
chk "backup recente ficou no remoto"     "[ -e '$T/remoto/dev-20200301-000000.db' ]"
chk "backup novo foi enviado"            "[ \$(ls '$T'/remoto | grep '^dev-' | grep -vc -e '^dev-20200101-000000.db\$' -e '^dev-20200301-000000.db\$') = 1 ]"
chk "arquivo alheio não foi tocado"      "[ -e '$T/remoto/outra-coisa.txt' ]"
chk ".env não foi copiado (local)"       "! ls '$T'/local/env-* 2>/dev/null | grep -q ."
chk ".env não foi copiado (remoto)"      "! ls '$T'/remoto | grep -q '^env-'"
chk "caminho do banco veio do DATABASE_URL" "[ \"\$(sqlite3 \"\$(ls '$T'/local/dev-*.db)\" 'select x from t')\" = 'VALOR_UNICO_$$' ]"

# DATABASE_URL relativo: tem que falhar fechado (não cair no caminho padrão)
printf 'DATABASE_URL="file:./dev.db"\n' > "$T/rel.env"
if env -u DATABASE_URL HERMES_ENV_FILE="$T/rel.env" HERMES_BACKUP_DEST="$T/local2" HERMES_BACKUP_REMOTE="nada:" \
     bash "$HERE/backup-db.sh" >/dev/null 2>"$T/rel.err"; then
  echo "FALHA DATABASE_URL relativo deveria abortar"; fail=1
else
  chk "DATABASE_URL relativo aborta"  "grep -q 'não é um caminho absoluto' '$T/rel.err'"
fi
exit $fail
