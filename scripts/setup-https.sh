#!/usr/bin/env bash
# Gera um certificado self-signed para o dev server subir em HTTPS.
# HTTPS local é o que libera o microfone do navegador (getUserMedia exige
# contexto seguro) ao acessar de outra máquina via Tailscale/LAN.
#
# Os certificados NÃO são versionados (.gitignore /certs/). Rode uma vez por máquina.
# Uso: bash scripts/setup-https.sh
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p certs

if ! command -v openssl >/dev/null 2>&1; then
  echo "erro: 'openssl' não encontrado no PATH." >&2
  exit 1
fi

# Monta a lista de SANs: localhost + IPs locais + nome do Tailscale (se houver).
SANS="DNS:localhost,IP:127.0.0.1"

if command -v tailscale >/dev/null 2>&1; then
  TS_NAME="$(tailscale status --json 2>/dev/null \
    | grep -m1 '"DNSName"' | sed -E 's/.*"DNSName": *"([^"]+)\.".*/\1/')"
  if [ -n "${TS_NAME:-}" ]; then
    SANS="$SANS,DNS:$TS_NAME"
  fi
fi

for ip in $(hostname -I 2>/dev/null); do
  case "$ip" in
    *:*) ;; # ignora IPv6 para simplicidade do cert
    *) SANS="$SANS,IP:$ip" ;;
  esac
done

echo "==> gerando certificado com SANs: $SANS"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/dev-key.pem -out certs/dev-cert.pem \
  -days 365 -subj "/CN=hermes-dev" \
  -addext "subjectAltName=$SANS"

echo
echo "Pronto. Suba o dev server (npm run dev) — ele detecta os certs e sobe em HTTPS."
echo "Acesse por https:// (clique 'avançar' uma vez no aviso de certificado)."
