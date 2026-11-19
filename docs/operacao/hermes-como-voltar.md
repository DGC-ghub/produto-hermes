# Hermes: como ver se caiu e como voltar

Uma página, para quem está de plantão. Itens `<PREENCHER>` dependem do servidor do Danilo
e do Uptime Kuma; o Arquiteto/sócio completa antes do piloto (DGC-349).
Nunca cole token, senha ou chave nesta página.

## 1. Como saber se caiu

- **Aviso automático:** o Uptime Kuma manda mensagem no Telegram quando um monitor cai
  ("DOWN") e quando volta ("UP"). Os monitores estão na seção 6.
- **Teste manual (de qualquer lugar com acesso):**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' https://<HOST_PUBLICO>/health
  # 200 = vivo e banco respondendo. 503 = app de pé, banco com problema. Sem resposta = caiu.
  curl -s -o /dev/null -w '%{http_code}\n' "https://<HOST_PUBLICO>/webhook/whatsapp"
  # 403 = saudável (a rota recusa GET sem o token de verificação da Meta). Outro código = problema.
  ```
- `/health` responde só `{"status":"ok"}` ou `{"status":"degraded"}`; não expõe versão nem dados.

## 2. Subir de novo

Hoje o serviço é um unit systemd de usuário chamado `hermes` (ver `deploy/hermes.service`).
No servidor do Danilo: `<CONFIRMAR: systemd de usuário, ou Docker?>`

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user status hermes        # está ativo?
systemctl --user restart hermes       # subir de novo
sleep 5; curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:5173/health   # espera 200
```

Se o problema começou logo depois de uma atualização, volte a versão anterior (segundos,
sem rebuild; ver `deploy/rollback.sh`):

```bash
deploy/rollback.sh
```

Se for Docker (`<CONFIRMAR>`): `docker ps -a | grep hermes` e `docker restart <container>`.

Não faça deploy novo nem mexa no `.env` durante a queda sem avisar um sócio.

## 3. Onde ver o log

- systemd/arquivo: `tail -n 100 <CAMINHO>/hermes.log` (no Pi: `~/projects/produto-hermes/hermes.log`).
- Docker: `docker logs --tail 100 <container>`.
- Log não deve ter token nem conteúdo de conversa; se tiver, avise o Arquiteto sem colar o trecho.

## 4. Se o WhatsApp desconectar

1. Confirme que o Hermes está de pé (seção 1). Se estiver, o problema é a conexão do número.
2. Abra o painel do operador, página **Canais** (`/canais`), e veja o status da conexão.
3. Número pelo QR (Baileys): quem tem o celular do número escaneia o QR novo na página.
   Número pela API oficial (Meta): veja o status do número e do token no painel da Meta; não troque
   token sem um sócio.
4. Se não reconectar em 15 minutos, ligue para quem está na seção 5 e avise a clínica que
   as mensagens estão sendo atendidas por pessoa.

## 5. Quem tem acesso e para quem ligar

| O quê | Quem | Contato |
|---|---|---|
| Servidor do Danilo (SSH/painel) | `<PREENCHER>` | `<PREENCHER>` |
| Uptime Kuma (admin) | `<PREENCHER>` | `<PREENCHER>` |
| Bot de Telegram do alerta | `<PREENCHER>` | `<PREENCHER>` |
| Painel da Meta / número do WhatsApp | `<PREENCHER>` | `<PREENCHER>` |
| Decisão de negócio (sócio de plantão) | `<PREENCHER>` | `<PREENCHER>` |

Ordem de ligação: 1) sócio de plantão, 2) Danilo (servidor), 3) Arquiteto.
Quem recebe o aviso do Telegram: `<PREENCHER, grupo ou pessoa>`.

## 6. Monitores no Uptime Kuma (configuração para criar)

Usar o Kuma que já existe no servidor. Nada de serviço novo.

| Monitor | Tipo | URL | Intervalo | Retentativas | Critério de saúde |
|---|---|---|---|---|---|
| Hermes saúde | HTTP(s) | `https://<HOST_PUBLICO>/health` | 60 s | 2 | código 200 |
| Hermes webhook WhatsApp | HTTP(s) | `https://<HOST_PUBLICO>/webhook/whatsapp` | 60 s | 2 | código aceito: **403** (GET sem token é recusado de propósito) |
| Hermes processo (opcional) | Docker container ou Push | `<CONFIRMAR>` | 60 s | 2 | container rodando |

Notas:
- Com 60 s e 2 retentativas, o aviso de queda chega em cerca de 3 minutos.
- Marcar notificar ao voltar (UP) e reenviar a cada 30 min enquanto estiver fora.
- **Notificação Telegram** (Settings > Notifications > Telegram): o *Bot Token* e o *Chat ID*
  são digitados direto na tela do Kuma, que os guarda no próprio banco. Nunca em arquivo do
  repositório, comentário de tarefa ou print. Criar o bot no @BotFather é feito por um sócio.
- Se o Kuma estiver na mesma máquina do Hermes, pode usar `https://localhost:5173` com
  "Ignorar erro de TLS" apenas nesse monitor local.

## 7. Teste de queda (registrar aqui depois de feito)

| Data/hora combinada | Parou às | Aviso DOWN chegou às | Voltou às | Aviso UP chegou às | Evidência |
|---|---|---|---|---|---|
| `<PENDENTE>` | | | | | print sem dado sensível, na tarefa DGC-349 |

Procedimento: avisar o sócio e a clínica, `systemctl --user stop hermes`, esperar 3 min,
conferir o DOWN no Telegram, `systemctl --user start hermes`, conferir o UP.
