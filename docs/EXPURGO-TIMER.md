# Expurgo diário do piloto (timer)

Apaga, todo dia às 03:30, as conversas que passaram do prazo de cada empresa (90 dias; dgc e demo, 7). Roda 15 min antes do backup das 03:45.

- Arquivos: `deploy/piloto/hermes-piloto-expurgo.service` e `.timer`.
- Comando: `npm run lgpd:retencao -- --confirmar` em `~/hermes-piloto/current`.
- Registro do que foi apagado: `~/hermes-piloto/data/lgpd-apagados.jsonl` (só é criado quando algo é apagado; sobrevive à troca de release).

## Instalar (na VM do piloto, com aval)
    cp deploy/piloto/hermes-piloto-expurgo.* ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now hermes-piloto-expurgo.timer
    systemctl --user list-timers

## Conferir sem apagar
    cd ~/hermes-piloto/current && npm run lgpd:retencao   # sem --confirmar = só mostra

## Desligar
    systemctl --user disable --now hermes-piloto-expurgo.timer
