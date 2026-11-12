# Backup off-site cifrado (marco M0.4)

O `scripts/backup-db.sh` já faz um snapshot local do banco (sem o `.env`) com
`integrity_check` e rotação — mas **no mesmo disco do Pi**. Falha de disco, roubo ou
perda do Pi levaria o banco E os backups juntos. Este passo manda uma cópia **cifrada**
pra fora, via `rclone`.

O script já tem o gancho: ao final de cada backup ele faz `rclone copy` para o remote
`hermes-crypt:` (ou o que estiver em `HERMES_BACKUP_REMOTE`). Enquanto esse remote não
existir, o backup local segue normal e o log diz `off-site PULADO`. Falta só **configurar
o remote uma vez** — passo interativo, por isso é você que roda.

## Por que um remote `crypt`

O `.env` tem segredos (token da Meta, `SESSION_SECRET`). A cópia não pode subir em claro
pra nuvem nenhuma. O `crypt` do rclone cifra nome e conteúdo **no Pi, antes de enviar** —
o provedor de nuvem só vê bytes embaralhados.

## Passo a passo (uma vez)

`rclone` já está instalado. Rode `rclone config` e crie **dois** remotes:

### 1) O remote base (a nuvem)
Escolha um backend barato. Exemplos comuns:
- **Backblaze B2** (`n` → nome `b2raw` → tipo `b2` → `account`/`key` do painel B2). ~centavos/mês pra alguns GB.
- **Google Drive** (`n` → nome `gdriveraw` → tipo `drive` → autenticar). Use se já tiver conta.

Anote o nome que você deu (ex.: `b2raw`).

### 2) O remote cifrado por cima do base
```
rclone config
  n) New remote
  name> hermes-crypt          # <- ESTE nome é o que o script espera
  Storage> crypt
  remote> b2raw:hermes-backup  # <base>:<bucket/pasta> onde os arquivos cifrados ficam
  filename_encryption> standard
  directory_name_encryption> true
  Password> (gere uma senha forte)
  Password2 (salt)> (gere outra, ou deixe em branco)
```

### 3) GUARDE as senhas do crypt fora do Pi
Sem a `Password`/`Password2` do `hermes-crypt` **não há como decifrar o backup**. Salve num
gerenciador de senhas. Se perder, o off-site vira lixo cifrado inútil.

## Provar que funcionou

```bash
# roda o backup manualmente e observa a linha do off-site
scripts/backup-db.sh
# esperado: "[backup-hermes] off-site ok: enviado pra hermes-crypt: (cifrado)"

# conferir o que subiu (decifrado pela sua config local):
rclone ls hermes-crypt:

# TESTE DE RESTORE (o que M0 exige): baixar num diretório limpo e abrir o banco
mkdir -p /tmp/restore-test && rclone copy hermes-crypt: /tmp/restore-test
sqlite3 "$(ls -t /tmp/restore-test/dev-*.db | head -1)" 'PRAGMA integrity_check;'  # -> ok
rm -rf /tmp/restore-test
```

## Trocar o destino
O script lê `HERMES_BACKUP_REMOTE` (default `hermes-crypt:`). Pra usar outro nome de remote,
exporte a variável no cron ou no ambiente do `backup-db.sh`.

## Prazo de guarda (LGPD, termo 5.3) e `.env`
- Depois de cada `rclone copy` bem-sucedido, o script roda `rclone delete --min-age 90d` no remote,
  só para `dev-*.db` e `env-*.bak` (legado). Mude o prazo com `HERMES_BACKUP_RETENTION_DAYS`.
- O remote do Hermes deve apontar para uma pasta só dele (nunca a raiz de um bucket compartilhado).
- O `.env` **não** entra mais no backup; as senhas ficam no cofre dos sócios. O script só lê o
  `DATABASE_URL` (do ambiente ou de `HERMES_ENV_FILE`) para achar o banco.
- Teste: `scripts/backup-db.test.sh` (remote local, dados fictícios).
