# Roteiro do piloto da Recepcionista (DGC-423)

Só a VM do piloto. Nada de mensagem a paciente ou clínica sem o "ok" dos sócios.

## Portas

| Porta | O que é | Quem acessa |
|---|---|---|
| 5190 | app Hermes (processo local) | só a própria VM / Funnel |
| 443 | Tailscale Funnel, **só** `/webhook/whatsapp` | a Meta (público) |
| 4443 | painel do operador (`/atendente`, `/dashboard`) | só pela rede Tailscale dos sócios |
| 10000 | demo (dados fictícios) | só rede Tailscale |

O Funnel nunca expõe o painel nem a demo: só o caminho do webhook.

## Deploy

1. `git fetch && git checkout <branch/tag aprovado>` (nunca `main` sem aval dos sócios).
2. `npm ci && npx prisma migrate deploy && npm run build`.
3. `.env` conforme `.env.example` (seção PILOTO). Segredos só aqui, fora do Git.
4. Config da clínica em `config/tenants/<slug>.json`. O opt-in vale ligado em produção.
5. Subir o serviço: `systemctl --user restart hermes` (unit em `deploy/hermes.service`, ajuste `PORT=5190`).
6. Funnel só para o webhook: `tailscale funnel --bg --set-path /webhook/whatsapp http://127.0.0.1:5190/webhook/whatsapp`.

## Conferir (3 passos)

```bash
curl -s  http://127.0.0.1:5190/health                          # {"status":"ok"} 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<host-funnel>/webhook/whatsapp -d '{}'   # 403 (sem assinatura)
curl -s "https://<host-funnel>/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=ERRADO&hub.challenge=1" -o /dev/null -w '%{http_code}\n'  # 403
```

`/health` não traz dado sensível: só `ok` ou `degraded` (503). Use-o no Kuma e no alerta da DGC-349.

## Rollback

`deploy/rollback.sh` (ou `git checkout <tag anterior> && npm ci && npm run build && systemctl --user restart hermes`).
Banco: restaurar o backup mais recente de `deploy/backup-offsite.md` só se a migração tiver mudado dado.
Emergência: `tailscale funnel --set-path /webhook/whatsapp off` corta a entrada pública na hora.

## Teste ponta a ponta (número de teste da Meta)

Só depois de infra e Funnel ligados. Registrar a URL do webhook no app da Meta, mandar uma mensagem do número de teste e ver a resposta. Conta e app da Meta são dos sócios.
