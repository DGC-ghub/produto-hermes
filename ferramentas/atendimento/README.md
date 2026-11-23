# Atendimento da DGC: Chatwoot + Evolution API

Caixa de entrada única do WhatsApp da DGC (DGC-371, parte do robô de vendas DGC-367).
Roda **só na VM trabalhadora** (arm64), nunca na Pi. Nada é aberto na internet.

```
WhatsApp ⇅ Evolution API (127.0.0.1:8090) ──▶ Chatwoot (127.0.0.1:3010) ──tailscale serve──▶ https://trabalhadora.tail04b4ef.ts.net:8443
                                                   └ Postgres (pgvector) + Redis + Sidekiq
```

## Versões fixadas (todas com imagem `linux/arm64`)
| Peça | Imagem |
|---|---|
| Chatwoot | `chatwoot/chatwoot:v4.19.1-ce` |
| Evolution API | `evoapicloud/evolution-api:v2.3.7` |
| Postgres | `pgvector/pgvector:pg16` |
| Redis | `redis:7-alpine` |

## Limites de memória
chatwoot-web 700M · sidekiq 600M · postgres 400M · redis 128M · evolution 400M (mais o `chatwoot-prepare`, que roda a migração e sai).

## Onde ficam as coisas
| O quê | Onde |
|---|---|
| Segredos do compose (senha do Postgres, `SECRET_KEY_BASE`, chaves) | `~/.config/dgc-atendimento/compose.env` (chmod 600). Modelo com valores falsos: `.env.example` |
| Token do agent bot do Chatwoot (para o robô) | `~/.config/dgc-atendimento/robo.env` (chmod 600) |
| Dados (Postgres, Redis, Evolution, anexos) | `~/.local/share/dgc-atendimento/` (chmod 700) |
| Backups | `~/backups/chatwoot/` (7 dias) |
| Checkout de trabalho | `~/apps/atendimento-infra/` |

Segredos nunca vão para o Git, para log ou para comentário.

## Como usar
O Docker é chamado com `sudo` (o usuário não entra no grupo `docker`, que equivale a root).

```bash
cd ~/apps/atendimento-infra/ferramentas/atendimento
DC="sudo docker compose --env-file $HOME/.config/dgc-atendimento/compose.env"

$DC up -d          # subir
$DC ps             # estado
$DC logs -f --tail 50 evolution
$DC down           # parar (os dados ficam)
```

### Primeira vez numa VM nova
1. Swap de 4 GB: `fallocate -l 4G /swapfile; chmod 600 /swapfile; mkswap /swapfile; swapon /swapfile` e a linha no `/etc/fstab`.
2. `apt install docker.io docker-compose-v2`.
3. Crie `compose.env` a partir do `.env.example`, gerando os valores com `openssl rand -hex 24` (e `-hex 64` para o `SECRET_KEY_BASE`), sem imprimir. Acrescente `DATA_DIR=$HOME/.local/share/dgc-atendimento`.
4. Suba (`up -d`). O `chatwoot-prepare` cria o banco sozinho.
5. Exponha só o Chatwoot: `sudo tailscale serve --bg --https=8443 http://127.0.0.1:3010`. A porta 443 já é de outro serviço da VM. O manager da Evolution **não** é exposto.

### Atualizar
Troque a versão fixada no `docker-compose.yml` (leia as notas da versão), faça um backup antes e rode `$DC pull && $DC up -d`. Para voltar atrás: volte a versão, `up -d` e, se a migração do Chatwoot já tiver rodado, restaure o backup.

### Backup e restauração
- Diário às 03:30, por timer de usuário (`dgc-atendimento-backup.timer`, unidades em `systemd/`): `pg_dump | gzip` dos bancos `chatwoot` e `evolution`, 7 dias.
- Manual: `scripts/backup.sh`.
- **Cópia para a Pi:** defina `PI_DEST=usuario@host:~/backups/chatwoot/` em `~/.config/dgc-atendimento/backup.env` (precisa de uma chave SSH até a Pi, o que é decisão de acesso dos sócios). Sem isso, o backup fica só nesta VM, o que não protege contra a perda da VM.
- Testar a restauração (num banco temporário, sem tocar no real): `scripts/testar-restauracao.sh`.
- Restaurar de verdade: pare `chatwoot-web` e `sidekiq`, depois `gunzip -c ARQUIVO | $DC exec -T postgres psql -U postgres -d chatwoot` (o dump usa `--clean --if-exists`), e suba de novo.

### Tailscale
`tailscale serve` publica `https://trabalhadora.tail04b4ef.ts.net:8443` (só para a tailnet, sem Funnel). A regra de ACL que limita os sócios à porta 8443 é de administrador da tailnet e está descrita na tarefa DGC-371.

## Contas e 2FA
- A tela de instalação do Chatwoot (`/installation/onboarding`) fica aberta até alguém criar o primeiro administrador. Cada sócio define a **própria** senha pelo navegador; nenhuma senha passa por agente ou comentário.
- 2FA: o Chatwoot 4.19 tem autenticação em dois fatores (Perfil > Segurança). Ligue nas contas dos sócios.
- O Chatwoot **não tem SMTP configurado**: não há e-mail de convite nem de "esqueci a senha". Ao convidar outro sócio, é preciso gerar o link de definição de senha na VM (ver o comentário da tarefa).

## Evolution API
Instância `dgc-vendas` (Baileys, conexão por QR como aparelho conectado). A chave da API fica no `compose.env` (`EVOLUTION_API_KEY`). A integração com o Chatwoot é configurada pela API da Evolution (`/chatwoot/set/dgc-vendas`) depois que o administrador existe. O bot do robô **só é ligado à caixa na DGC-370**, com o robô de pé.

## Aprendizados
- **RAM (parado, sem conversa), medida em 19/11/2026:** chatwoot-web ~427 MiB, sidekiq ~404 MiB, evolution ~205 MiB, postgres ~65 MiB, redis ~14 MiB; total ~1,1 GB. A VM (7,7 GB) ficou com ~5,4 GB disponíveis (trava: 2,5 GB).
- A imagem `chatwoot` precisa de Postgres com a extensão `pgvector` (por isso `pgvector/pgvector:pg16`).
- O Chatwoot rodou com 1 processo e 3 threads (`WEB_CONCURRENCY=1`) para caber nos limites.
- A porta 443 da tailnet da VM já era de outro serviço; o Chatwoot usa a 8443.
- Sem SMTP, convidar usuário exige um passo manual na VM.
- (A completar: medição com 1 conversa, o que o app faz bem e mal no celular, push.)

### Ligação Evolution → Chatwoot (19/11, DGC-371)
- Usuário de serviço `Integracao Evolution` (administrador, e-mail `.invalid`) existe só para dar o token à Evolution. Não é pessoa.
- Config feita por `POST /chatwoot/set/dgc-vendas` com `autoCreate=true`, `importContacts=false`, `importMessages=false` (sem histórico antigo), `conversationPending=false`, URL interna `http://chatwoot-web:3000`.
- **Armadilha:** `SERVER_URL` da Evolution define a URL de webhook gravada na caixa do Chatwoot. Com `127.0.0.1:8090` o Chatwoot (dentro do contêiner) não alcança a Evolution. Use o nome interno `http://evolution:8080`.
- O QR aparece no Chatwoot, como imagem na conversa do contato "DGC Hub" (+123456) da caixa "WhatsApp DGC". Se expirar, escrever `init` nessa conversa gera outro.
- Agent bot `Robo de vendas DGC` criado, token em `~/.config/dgc-atendimento/robo.env`, **sem caixa ligada** (DGC-370).
- RAM com 1 conversa (a do QR): evolution 143 MiB, sidekiq 583 MiB (limite 600: apertado), web 395, postgres 114, redis 15. VM com 5,2 GB disponíveis.
- Novos usuários: `scripts/criar-usuario.sh "Nome" email` (senha digitada na VM, sem eco).
- **Armadilha 2 (22/11, número conectado):** o Chatwoot v4 bloqueia webhook para endereço privado (`SafeFetch`, erro `Hostname 'evolution' has no public ip addresses`), então o `init` e toda resposta enviada pelo Chatwoot ao WhatsApp não saíam. Correção: `SAFE_FETCH_ALLOW_PRIVATE_NETWORK: "true"` no `x-chatwoot-env` (aprovada pelo Gabriel; a rede é interna do Docker). Depois disso a instância `dgc-vendas` ficou `open`.
- RAM com o número conectado: chatwoot-web 604/700 MiB, sidekiq 530/600 MiB (apertado), evolution 154 MiB. VM com ~5,4 GB disponíveis. Se o sidekiq estourar, subir o limite para 800M.
