#!/usr/bin/env bash
# Rollback do Hermes: reaponta 'current' para o release ANTERIOR e reinicia — em segundos.
# Marco M0.2. Não rebuilda nada: o release anterior já está pronto no disco, então
# voltar é só trocar o symlink (atômico) e reiniciar o serviço.
#
#   deploy/rollback.sh          # volta pro release imediatamente anterior
set -euo pipefail

DEPLOY="${HERMES_DEPLOY:-/home/pi/hermes-deploy}"
[ -L "$DEPLOY/current" ] || { echo "[rollback] $DEPLOY/current não existe (fez o cutover?)" >&2; exit 1; }

cur="$(readlink -f "$DEPLOY/current")"
# Release anterior = o mais novo que NÃO é o atual.
prev="$(ls -1dt "$DEPLOY/releases"/*/ 2>/dev/null | sed 's:/*$::' | grep -vFx "$cur" | head -1)"
[ -n "$prev" ] || { echo "[rollback] não há release anterior para voltar" >&2; exit 1; }

echo "[rollback] $cur  ->  $prev"
ln -sfn "$prev" "$DEPLOY/current.tmp"
mv -T "$DEPLOY/current.tmp" "$DEPLOY/current"

if [ "${RESTART:-1}" = "1" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  systemctl --user restart hermes
fi
echo "[rollback] OK: current -> $prev"
