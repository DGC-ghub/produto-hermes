# Infra do piloto (Recepcionista) na VM trabalhadora (DGC-422)

Tudo roda na VM `trabalhadora`. Nada na Pi, a não ser receber o backup cifrado (ver "Backup", pendente de aval).

## Pastas e serviço
```
~/hermes-piloto/
├── releases/<data>/   código + build (imutável)
├── current -> releases/<data>
├── shared/            .env (chmod 600), certs/, config/, knowledge/
├── data/piloto.db     banco SQLite, fora do release
└── evidencias/        serve-antes.json e serve-depois.json
```
- Serviço de usuário `deploy/piloto/hermes-piloto.service`: `node --env-file-if-exists=.env server.js`, `NODE_ENV=production`, `Restart=always`, `MemoryMax=900M`, escuta só em `127.0.0.1:5190` (HTTPS com cert próprio, autoassinado).
- Deploy: `HERMES_REPO=<clone> HERMES_DEPLOY=~/hermes-piloto HERMES_UNIT=hermes-piloto deploy/release.sh <ref>`; volta atrás: `HERMES_DEPLOY=~/hermes-piloto HERMES_UNIT=hermes-piloto deploy/rollback.sh`.
- O `.env` do piloto é próprio, com segredos novos, e nada foi copiado da demo. `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` ficam vazios até existir o app da Meta. `ATTENDANT_PROVIDER=mock` até o Dev de Entrega fechar o cérebro real.
- A demo (`hermes-demo.service`, 5180) não foi alterada.

## Portas (`tailscale serve`, todas só na tailnet por enquanto)
| Porta | O que serve | Destino |
|---|---|---|
| 443 | só `/webhook/whatsapp` (a raiz não tem handler: 404) | `https+insecure://127.0.0.1:5190/webhook/whatsapp` |
| 4443 | painel do piloto | `https+insecure://127.0.0.1:5190` |
| 10000 | demo (**nova URL**: `https://trabalhadora.tail04b4ef.ts.net:10000`) | `https+insecure://127.0.0.1:5180` |
| 8443 | Chatwoot (como estava) | `http://127.0.0.1:3010` |

Comandos usados (precisam de `sudo`):
```
sudo tailscale serve --https=10000 --bg https+insecure://127.0.0.1:5180
sudo tailscale serve --https=443 off
sudo tailscale serve --https=443 --bg --set-path /webhook/whatsapp https+insecure://127.0.0.1:5190/webhook/whatsapp
sudo tailscale serve --https=4443 --bg https+insecure://127.0.0.1:5190
```

## Ligar o Funnel (NÃO rodar antes de o Gabriel liberar a ACL e o Arquiteto mandar)
```
sudo tailscale funnel --bg --https=443 --set-path /webhook/whatsapp https+insecure://127.0.0.1:5190/webhook/whatsapp
```
Prova, de fora da tailnet (celular em 4G, por exemplo):
```
curl -s -o /dev/null -w '%{http_code}\n' https://trabalhadora.tail04b4ef.ts.net/webhook/whatsapp   # 403
for p in / /login /atendente; do curl -s -o /dev/null -w "$p %{http_code}\n" https://trabalhadora.tail04b4ef.ts.net$p; done   # 404 nos três
```
Desligar (volta a ser só tailnet): `sudo tailscale funnel --https=443 off` e repetir o `serve` da 443 acima.

## Backup
- `scripts/backup-db.sh` (snapshot `.backup` + `integrity_check`, remoto com guarda de 90 dias, `.env` fora do backup) roda pelo timer `hermes-piloto-backup.timer`, todo dia às **03:45** (`Persistent=true`).
- Configuração em `~/.config/hermes-piloto/` (`backup.env` e `rclone.conf`, ambos `chmod 600`). O remote é `hermes-crypt:` (rclone crypt, nomes e conteúdo cifrados).
- **Situação:** a base do crypt está **interina**, em `~/backups/hermes-piloto-interino` (mesmo disco: serve para provar o mecanismo, não protege contra perda da VM). Para virar off-site de verdade falta o aval dos sócios para a chave SSH da VM na Pi (usuário só com a pasta de backup). Depois disso, trocar `remote =` do `[hermes-crypt]` para `hermes-sftp:hermes-piloto` e criar `[hermes-sftp]` (`type = sftp`).
- A senha e o salt do crypt: sem eles o backup não abre. Estão só no `rclone.conf` (ofuscados) e precisam ir para o gerenciador de senhas dos sócios.
- Teste de restauração (repetir depois de trocar a base):
```
export RCLONE_CONFIG=~/.config/hermes-piloto/rclone.conf
T=$(mktemp -d); rclone copy hermes-crypt: "$T"
sqlite3 "$(ls -t $T/dev-*.db | head -1)" 'PRAGMA integrity_check;'   # ok
rm -rf "$T"
```
