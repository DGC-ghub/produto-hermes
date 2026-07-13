#!/usr/bin/env bash
# Publica um RELEASE versionado do Hermes e vira o symlink 'current' de forma ATÔMICA.
#
# Marco M0.2 — dá rollback de verdade (rollback.sh reaponta o symlink em segundos) e
# desacopla CÓDIGO (versionado, imutável por release) de ESTADO (shared/: .env, certs,
# config, knowledge; o banco fica no path absoluto do .env, fora daqui).
#
# NÃO faz o primeiro cutover — ver deploy/releases.md para o setup inicial do shared/
# e a troca do WorkingDirectory do hermes.service. Depois do cutover, um deploy é:
#   deploy/release.sh <ref>      # publica o commit <ref> (default: HEAD)
set -euo pipefail

REPO="${HERMES_REPO:-/home/pi/projects/produto-hermes}"   # fonte do código (git)
DEPLOY="${HERMES_DEPLOY:-/home/pi/hermes-deploy}"          # raiz do deploy versionado
SHARED="$DEPLOY/shared"                                    # estado que persiste
KEEP="${HERMES_KEEP:-5}"                                   # releases a manter
REF="${1:-HEAD}"

command -v git >/dev/null || { echo "[release] git ausente" >&2; exit 1; }
[ -d "$SHARED" ] || { echo "[release] falta $SHARED — rode o setup inicial (deploy/releases.md)" >&2; exit 1; }

ts="$(date +%Y%m%d-%H%M%S)"
rel="$DEPLOY/releases/$ts"
mkdir -p "$rel"

echo "[release] exportando '$REF' do repositório..."
git -C "$REPO" archive "$REF" | tar -x -C "$rel"

echo "[release] ligando o estado compartilhado (shared/)..."
# config/ e knowledge/ (e certs/) VÊM no git archive — removê-los antes, senão o
# 'ln -sfn' criaria o link DENTRO do diretório existente em vez de substituí-lo.
rm -rf "$rel/.env" "$rel/certs" "$rel/config" "$rel/knowledge"
ln -sfn "$SHARED/.env"      "$rel/.env"
ln -sfn "$SHARED/certs"     "$rel/certs"
ln -sfn "$SHARED/config"    "$rel/config"
ln -sfn "$SHARED/knowledge" "$rel/knowledge"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "[release] npm ci + build + prisma generate (pode levar minutos)..."
  ( cd "$rel" && npm ci && npm run build && npx prisma generate )
  # Guard: só vira 'current' se o build realmente produziu o server — senão o
  # release está quebrado e NÃO pode substituir o que está no ar.
  [ -f "$rel/build/server/index.js" ] || {
    echo "[release] BUILD FALHOU (sem build/server/index.js) — abortando, 'current' intacto" >&2
    rm -rf "$rel"; exit 1
  }
fi

echo "[release] virando 'current' atomicamente..."
ln -sfn "$rel" "$DEPLOY/current.tmp"
mv -T "$DEPLOY/current.tmp" "$DEPLOY/current"

if [ "${RESTART:-1}" = "1" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  # Migração precisa do banco LIVRE (lock do SQLite) → serviço parado; e precisa correr
  # ANTES do serviço subir com o código novo (que espera as colunas novas). Se falhar,
  # NÃO sobe o release novo: reaponta 'current' pro anterior e sobe — nunca deixa código
  # novo contra schema velho (issue #3 da auditoria de estabilização).
  systemctl --user stop hermes
  if ( cd "$DEPLOY/current" && npx prisma migrate deploy ); then
    systemctl --user start hermes && echo "[release] migrado + serviço reiniciado"
  else
    echo "[release] MIGRATE FALHOU — revertendo 'current' pro release anterior" >&2
    prev="$(ls -1dt "$DEPLOY/releases"/*/ 2>/dev/null | sed 's:/*$::' | grep -vFx "$(readlink -f "$DEPLOY/current")" | head -1)"
    [ -n "$prev" ] && { ln -sfn "$prev" "$DEPLOY/current.tmp"; mv -T "$DEPLOY/current.tmp" "$DEPLOY/current"; }
    systemctl --user start hermes
    exit 1
  fi
fi

# Rotação: mantém os $KEEP releases mais novos (o rollback precisa de histórico).
ls -1dt "$DEPLOY/releases"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf

echo "[release] OK: current -> $rel"
