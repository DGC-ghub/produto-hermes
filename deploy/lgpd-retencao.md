# Rotina diária de guarda LGPD (DGC-91)

Apaga conversas, mensagens, leads, chamados e eventos mais antigos que o prazo de cada
empresa (`Tenant.retentionDays`, padrão 90 dias; demo pública: 7 dias), com base na
**última atividade da conversa**.

> **Não instalar sem o aval dos sócios.** Antes: aplicar a migration
> `20261113120000_tenant_retention_days` (adiciona a coluna) e testar com `--dry-run`.

## Comandos

```
npm run lgpd:retencao                      # dry-run: só conta
npm run lgpd:retencao -- --confirmar       # apaga de verdade
npm run lgpd:apagar-contato -- --tenant <slug> --contato <contactId> [--confirmar]
npm run lgpd:apagar-tenant  -- --tenant <slug> [--confirmar]
```

O registro (uma linha JSON por execução, em `$LGPD_LOG`, padrão `logs/lgpd-apagados.jsonl`)
tem só contagens, ids internos e data. O contato aparece como hash, nunca o telefone.
`apagar-tenant` preserva as contas de login (`Account`); remove só o vínculo com a empresa.

## Exemplo de cron (diário, 03:30)

```
30 3 * * * cd /caminho/do/produto-hermes && npm run lgpd:retencao -- --confirmar >> logs/lgpd-cron.log 2>&1
```

## Exemplo de systemd timer

`hermes-lgpd.service`:
```
[Service]
Type=oneshot
WorkingDirectory=/caminho/do/produto-hermes
ExecStart=/usr/bin/npm run lgpd:retencao -- --confirmar
```
`hermes-lgpd.timer`:
```
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
```

## Limites conhecidos

- Backups já feitos seguem o prazo de rotação do backup (ver `backup-offsite.md`).
- `apagar-contato` casa o `contactId` exato; no Baileys o mesmo contato pode aparecer
  como `@lid` e como número: rode para os dois ids se necessário.

## Segredo do registro (obrigatório)

`LGPD_HASH_SECRET` (mínimo 16 caracteres, aleatório, só no `.env` do servidor) protege o hash do
contato no registro (HMAC). Sem ele, `apagar-contato` falha antes de apagar qualquer coisa.
O `--contato` fica no histórico do shell: rode o comando com um espaço na frente
(`HISTCONTROL=ignorespace`) ou limpe o histórico depois.
A rotina `retencao` sai com código 1 se algum tenant falhar; os que terminaram já estão no registro.
