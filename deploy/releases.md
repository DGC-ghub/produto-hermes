# Deploy versionado com rollback (marco M0.2)

Hoje o serviço roda **da working tree** (`WorkingDirectory=/home/pi/projects/produto-hermes`):
um deploy é `git pull + npm build + restart`, e voltar atrás significa rebuildar o commit
antigo na mão. Este modelo troca isso por **releases imutáveis + symlink atômico**, então
o rollback é reapontar um link e reiniciar — segundos.

```
/home/pi/hermes-deploy/
├── releases/
│   ├── 20260706-170000/     ← código do commit + build (imutável)
│   └── 20260706-181500/
├── current  ->  releases/20260706-181500     ← symlink atômico (o serviço roda daqui)
└── shared/                  ← ESTADO que persiste entre releases
    ├── .env                 ← segredos
    ├── certs/               ← TLS
    ├── config/              ← configs de tenant (mutáveis em runtime)
    └── knowledge/           ← bases de conhecimento (mutáveis em runtime)
```

O **banco não entra aqui**: `DATABASE_URL` é absoluto (`file:/home/pi/.../dev.db`), então o
serviço acha o banco pelo path fixo, rode ele de onde rodar. (O backup off-site cobre o banco.)

## Uso diário (depois do cutover)

```bash
deploy/release.sh              # publica HEAD: exporta o commit, build, vira 'current', reinicia
deploy/release.sh <ref>        # publica um commit/branch específico
deploy/rollback.sh             # volta pro release anterior em segundos
```

Variáveis: `HERMES_DEPLOY` (raiz, default `/home/pi/hermes-deploy`), `HERMES_KEEP` (releases
mantidos, default 5), `RESTART=0` (só publica, não reinicia), `SKIP_BUILD=1` (teste da mecânica).

## Primeiro cutover (uma vez — reinicia o serviço)

> Faça isto num momento tranquilo. O serviço dá um blip de segundos no restart.

```bash
export HERMES_DEPLOY=/home/pi/hermes-deploy
REPO=/home/pi/projects/produto-hermes

# 1) Cria o shared/ e SEMEIA com o estado atual (segredos, certs, dados de tenant)
mkdir -p "$HERMES_DEPLOY/shared"
cp "$REPO/.env"            "$HERMES_DEPLOY/shared/.env"
cp -r "$REPO/certs"        "$HERMES_DEPLOY/shared/certs"
cp -r "$REPO/config"       "$HERMES_DEPLOY/shared/config"
cp -r "$REPO/knowledge"    "$HERMES_DEPLOY/shared/knowledge"

# 2) Publica o primeiro release SEM reiniciar ainda (o serviço velho segue no ar)
RESTART=0 "$REPO/deploy/release.sh" HEAD
ls -l "$HERMES_DEPLOY/current"     # confirma que aponta pro release

# 3) Aponta o hermes.service pro 'current' e recarrega
#    Troque no unit:  WorkingDirectory=/home/pi/hermes-deploy/current
#    E os caminhos de log:  StandardOutput/Error=append:/home/pi/hermes-deploy/shared/hermes.log
sed -i 's#WorkingDirectory=/home/pi/projects/produto-hermes#WorkingDirectory=/home/pi/hermes-deploy/current#' \
    "$REPO/deploy/hermes.service"
# (edite os StandardOutput/Error à mão se quiser o log no shared/)
cp "$REPO/deploy/hermes.service" ~/.config/systemd/user/hermes.service
systemctl --user daemon-reload
systemctl --user restart hermes

# 4) Verifica no ar
systemctl --user is-active hermes
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:5173/login   # 200
```

## Provar o rollback (critério do M0)

```bash
deploy/release.sh HEAD                 # release A (no ar)
# faça uma mudança boba visível, commite, e:
deploy/release.sh HEAD                 # release B (no ar)
deploy/rollback.sh                     # volta pra A em segundos
systemctl --user is-active hermes      # active
curl -sk https://localhost:5173/login  # responde, servindo A de novo
```

## Nota sobre `config/` e `knowledge/` (dívida honesta)

Eles são **shared** porque o runtime os EDITA (`saveTenantConfig` grava JSON; tenant novo cria
arquivo). Consequência: depois do cutover, atualizar um config **versionado no git** (ex.:
`config/tenants/csmed.json`) não chega ao serviço sozinho — a fonte da verdade passa a ser
`shared/`. Isso é a mesma fragilidade que a auditoria apontou (gap "config em arquivo"): o
marco **M2** migra config e knowledge para o banco e resolve isso de vez. Até lá, para propagar
uma mudança versionada, edite também `shared/config` / `shared/knowledge`.
