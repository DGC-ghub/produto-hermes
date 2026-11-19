#!/usr/bin/env bash
# Cria um usuario (administrador) no Chatwoot. A senha é digitada aqui, na VM, sem eco:
# não passa por comentário, histórico nem argumento de comando.
# Uso: scripts/criar-usuario.sh "Nome" email@exemplo.com
set -euo pipefail
NOME="${1:?uso: criar-usuario.sh \"Nome\" email}"; EMAIL="${2:?uso: criar-usuario.sh \"Nome\" email}"
ENVF="${ENV_FILE:-$HOME/.config/dgc-atendimento/compose.env}"
cd "$(dirname "$0")/.."
read -r -s -p "Senha (mín. 8, com maiúscula, minúscula e número): " P1; echo
read -r -s -p "Repita a senha: " P2; echo
[ "$P1" = "$P2" ] || { echo "Senhas diferentes."; exit 1; }
sudo docker compose --env-file "$ENVF" exec -T -e U_NOME="$NOME" -e U_EMAIL="$EMAIL" -e U_PW="$P1" chatwoot-web \
  bundle exec rails runner '
u = User.find_by(email: ENV["U_EMAIL"]) || User.new(email: ENV["U_EMAIL"])
u.name = ENV["U_NOME"]; u.password = u.password_confirmation = ENV["U_PW"]
u.skip_confirmation!; u.save!
au = AccountUser.find_or_initialize_by(account_id: 1, user_id: u.id); au.role = :administrator; au.save!
puts "ok: #{u.email} (administrador)"' 2>&1 | grep -E '^ok|rror'
