#!/usr/bin/env bash
# Vigia do Hermes piloto (DGC-349). Roda a cada 60 s por timer de usuário.
# Checa /health local e o webhook público. Avisa só na MUDANÇA (DOWN depois de 2 falhas seguidas, UP ao voltar).
# Segredos só no EnvironmentFile (chmod 600), nunca aqui. VIGIA_DRY_RUN=1 só imprime o aviso.
set -u
LOCAL_URL="${VIGIA_LOCAL_URL:-https://127.0.0.1:5190/health}"   # o piloto serve HTTPS (certificado próprio)
PUBLIC_URL="${VIGIA_PUBLIC_URL:-}"              # ex.: https://<host>.ts.net/webhook/whatsapp (vazio = não checa)
STATE="${VIGIA_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/hermes-vigia.state}"
mkdir -p "$(dirname "$STATE")"

code() { curl -s ${2:-} -o /dev/null -m 10 -w '%{http_code}' "$1" 2>/dev/null || echo 000; }

falha=""
[ "$(code "$LOCAL_URL" -k)" = 200 ] || falha="saude local fora"
if [ -n "$PUBLIC_URL" ] && [ "$(code "$PUBLIC_URL")" != 403 ]; then falha="${falha:+$falha; }webhook publico fora"; fi

estado=$(cut -d' ' -f1 "$STATE" 2>/dev/null || echo UP)
falhas=$(cut -d' ' -f2 "$STATE" 2>/dev/null || echo 0)

avisar() {
  local texto="$1"
  if [ "${VIGIA_DRY_RUN:-0}" = 1 ]; then echo "AVISO: $texto"; return 0; fi
  # Reserva: caixa "Alertas do robô" no Chatwoot (conversa já existente, mensagem de saída).
  if [ -n "${CHATWOOT_URL:-}" ] && [ -n "${CHATWOOT_TOKEN:-}" ] && [ -n "${CHATWOOT_ACCOUNT:-}" ] && [ -n "${CHATWOOT_CONVERSA:-}" ]; then
    curl -s -m 15 -o /dev/null -X POST -H "api_access_token: $CHATWOOT_TOKEN" -H 'Content-Type: application/json' \
      "$CHATWOOT_URL/api/v1/accounts/$CHATWOOT_ACCOUNT/conversations/$CHATWOOT_CONVERSA/messages" \
      -d "$(printf '{"content":"%s","message_type":"outgoing","private":false}' "$texto")"
  fi
  # WhatsApp do sócio via Evolution API (mesmo canal de comando do robô de vendas).
  if [ -n "${EVOLUTION_URL:-}" ] && [ -n "${EVOLUTION_KEY:-}" ] && [ -n "${EVOLUTION_INSTANCIA:-}" ] && [ -n "${ALERTA_NUMEROS:-}" ]; then
    for n in ${ALERTA_NUMEROS//,/ }; do
      curl -s -m 15 -o /dev/null -X POST -H "apikey: $EVOLUTION_KEY" -H 'Content-Type: application/json' \
        "$EVOLUTION_URL/message/sendText/$EVOLUTION_INSTANCIA" -d "$(printf '{"number":"%s","text":"%s"}' "$n" "$texto")"
    done
  fi
}

if [ -n "$falha" ]; then
  falhas=$((falhas + 1))
  if [ "$estado" = UP ] && [ "$falhas" -ge 2 ]; then
    estado=DOWN; avisar "Hermes piloto FORA ($falha). Veja docs/operacao/hermes-como-voltar.md"
  fi
else
  if [ "$estado" = DOWN ]; then avisar "Hermes piloto VOLTOU."; fi
  estado=UP; falhas=0
fi
echo "$estado $falhas" > "$STATE"
