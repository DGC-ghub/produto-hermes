# Deploy do Hermes (piloto no Pi)

Produção roda o **build** (não o dev server): imune a edição da working tree / `git
checkout` ao vivo (bloqueio C3 do [plano de entrega](../docs/plano-entrega-2026.md)).

## Serviço systemd (user)

`hermes.service` aqui é a **cópia versionada** do unit que vive em
`~/.config/systemd/user/hermes.service`. Ao mudar um, copie para o outro:

```bash
cp deploy/hermes.service ~/.config/systemd/user/hermes.service
systemctl --user daemon-reload
```

Roda `node --env-file-if-exists=.env server.js` com `NODE_ENV=production` — serve
HTTPS na 5173 com os certs de `certs/` (mesma porta/protocolo do funnel, então o
cookie Secure do operador e o microfone da demo seguem funcionando).

## Ciclo de deploy (uma mudança de código)

```bash
git pull                 # ou merge da branch
npm ci                   # se package-lock mudou
npm run build            # gera build/ (produção lê daqui, não da working tree)
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user restart hermes
```

Sem `npm run build`, o `restart` sobe o build ANTIGO — a working tree nova só entra
no ar no próximo build. É exatamente isso que protege o atendimento de edições soltas.

## Verificar

```bash
systemctl --user is-active hermes
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:5173/login          # 200
curl -s  -o /dev/null -w '%{http_code}\n' https://cryptobot.tail04b4ef.ts.net/webhook/whatsapp  # 403 (público, saudável)
tail -5 hermes.log
```
