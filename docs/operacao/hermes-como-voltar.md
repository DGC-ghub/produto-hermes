# Hermes piloto: como ver se caiu e como voltar

Uma página, para quem está de plantão. Itens `<PREENCHER>` o sócio completa antes do piloto (DGC-349).
Nunca cole token, senha ou chave aqui.

O piloto roda na **VM trabalhadora** (não no servidor do Danilo): serviço de usuário
`hermes-piloto.service`, porta `127.0.0.1:5190` (HTTPS), atrás do `tailscale serve`; só `/webhook/whatsapp`
fica público (Funnel). Infra: DGC-422.

## 1. Como saber se caiu

- **Aviso automático:** o vigia (`hermes-piloto-vigia.timer`, a cada 60 s) manda mensagem no **WhatsApp do sócio**
  e na caixa **"Alertas do robô"** do Chatwoot: "FORA" depois de 2 falhas seguidas (~2 min) e "VOLTOU".
- **Teste manual:**
  ```bash
  curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:5190/health   # na VM: 200 = vivo e banco ok
  curl -s -o /dev/null -w '%{http_code}\n' https://trabalhadora.tail04b4ef.ts.net/webhook/whatsapp   # 403 = saudável
  ```
  `/health` 503 = app de pé, banco com problema. Sem resposta = caiu. Webhook 403 sem token é o normal.

## 2. Subir de novo (na VM, usuário `dgc`)

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user status hermes-piloto
systemctl --user restart hermes-piloto
sleep 5; curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:5190/health   # espera 200
```
Logo depois de atualização: `HERMES_UNIT=hermes-piloto deploy/rollback.sh` (volta a versão anterior em segundos; ver `deploy/releases.md`).
Não faça deploy nem mexa no `.env` durante a queda sem avisar um sócio.
Se o webhook público falha mas o `/health` local está 200: confira `tailscale serve status` e o Funnel (`tailscale funnel status`).

## 3. Onde ver o log

`journalctl --user -u hermes-piloto -n 100 --no-pager`. Não deve ter token nem conversa; se tiver, avise o Arquiteto sem colar o trecho.

## 4. Se o WhatsApp desconectar

1. Confirme que o Hermes está de pé (seção 1). Se estiver, o problema é a conexão do número.
2. Painel do operador, página **Canais** (`/canais`): veja o status.
3. API oficial (Meta): veja número e token no painel da Meta; não troque token sem um sócio.
4. Sem reconectar em 15 minutos: ligue para quem está na seção 5 e avise que a clínica será atendida por pessoa.

## 5. Quem tem acesso e para quem ligar

| O quê | Quem | Contato |
|---|---|---|
| VM trabalhadora (SSH, serviço) | `<PREENCHER>` | `<PREENCHER>` |
| Tailscale (ACL/Funnel) | Gabriel | `<PREENCHER>` |
| Chatwoot ("Alertas do robô") | `<PREENCHER>` | `<PREENCHER>` |
| Painel da Meta / número do WhatsApp | `<PREENCHER>` | `<PREENCHER>` |
| Sócio de plantão | `<PREENCHER>` | `<PREENCHER>` |

Ordem: 1) sócio de plantão, 2) Arquiteto. Quem recebe o aviso: `<PREENCHER números, em ALERTA_NUMEROS>`.

## 6. O vigia (como está montado)

Arquivos: `scripts/vigia-hermes.sh`, `deploy/piloto/hermes-piloto-vigia.{service,timer}`.
Credenciais só em `~/.config/hermes-piloto/vigia.env` (`chmod 600`, fora do Git), variáveis:
`VIGIA_PUBLIC_URL`, `CHATWOOT_URL/TOKEN/ACCOUNT/CONVERSA`, `EVOLUTION_URL/KEY/INSTANCIA`, `ALERTA_NUMEROS`.
Instalar (precisa do aval dos sócios): copiar os dois units para `~/.config/systemd/user/`,
`systemctl --user daemon-reload && systemctl --user enable --now hermes-piloto-vigia.timer`.
Teste sem enviar nada: `VIGIA_DRY_RUN=1 scripts/vigia-hermes.sh`.
**Limite:** se a VM inteira cair, o vigia cai junto. Por isso o Kuma do Danilo entra depois, de fora, com os
mesmos dois endereços (`/health` por HTTPS e o webhook com 403 aceito).

## 7. Teste de queda (registrar depois de feito)

| Combinado | Parou às | Aviso FORA às | Voltou às | Aviso VOLTOU às | Evidência |
|---|---|---|---|---|---|
| `<PENDENTE>` | | | | | print sem dado sensível, em DGC-349 |

Procedimento: avisar o sócio, `systemctl --user stop hermes-piloto`, esperar 3 min, conferir o aviso de queda,
`systemctl --user start hermes-piloto`, conferir o de volta. Não pare o piloto com atendimento real em curso.
