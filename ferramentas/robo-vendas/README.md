# Robô de vendas da DGC (WhatsApp + Telegram)

Manda a 1ª mensagem às clínicas da campanha, faz o acompanhamento (lembretes no 3º e no 7º dia útil) e passa ao Gabriel, no Telegram, tudo o que for de venda. Plano: DGC-367. Roda **só na VM trabalhadora**, nunca na Pi.

- WhatsApp: Baileys `7.0.0-rc14` (versão fixada), como aparelho conectado. Está atrás de um adaptador (`src/adaptador-whatsapp.ts`): se precisar trocar de versão, só ele muda.
- Telegram: grammy, long polling. Funil: `node:sqlite` (Node 24, sem build). O código `.ts` roda direto no Node, sem compilar.
- Isolado do produto: pasta própria, `package.json` próprio.

## Instalar na VM

```bash
git clone -b feat/robo-vendas https://github.com/DGC-ghub/produto-hermes.git
cd produto-hermes/ferramentas/robo-vendas
export npm_config_store_dir=/home/dgc/.cache/pnpm-store
npm ci

mkdir -p ~/.config/dgc-robo-vendas ~/.local/share/dgc-robo-vendas/midia
chmod 700 ~/.config/dgc-robo-vendas ~/.local/share/dgc-robo-vendas
# segredos (quem grava é o Gabriel; nunca vão para o Git):
install -m 600 /dev/null ~/.config/dgc-robo-vendas/env
#   TELEGRAM_BOT_TOKEN=...
#   TELEGRAM_CHAT_ID=...
# mídia: o vídeo v2 e os 10 PDFs (nome igual ao campo `pdf` de config/campanha.json)
cp demo-recepcionista-ia-v2.mp4 *.pdf ~/.local/share/dgc-robo-vendas/midia/
```

## Onde ficam as coisas

| O quê | Onde |
|---|---|
| Segredos (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) | `~/.config/dgc-robo-vendas/env` (chmod 600) |
| Sessão do WhatsApp, funil, mídia | `~/.local/share/dgc-robo-vendas/` (`wa-auth/`, `funil.sqlite`, `midia/`) |
| Campanha (10 clínicas, textos, telefone e fonte) | `config/campanha.json` (no Git) |
| Campanha de teste (1 "clínica", telefone vazio) | `config/campanha-teste.json` |

`DADOS_DIR` troca a pasta de dados, se precisar.

## Serviço `systemd --user`

`~/.config/systemd/user/dgc-robo-vendas.service` (o linger já está ligado):

```ini
[Unit]
Description=Robô de vendas DGC
After=network-online.target

[Service]
WorkingDirectory=%h/produto-hermes/ferramentas/robo-vendas
EnvironmentFile=%h/.config/dgc-robo-vendas/env
ExecStart=/usr/bin/env bash -lc 'exec node src/main.ts'
Restart=on-failure
RestartSec=10
MemoryMax=300M

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now dgc-robo-vendas
journalctl --user -u dgc-robo-vendas -f
```

Na primeira subida o robô manda o **QR como imagem no Telegram**. O Gabriel escaneia em WhatsApp Business > Aparelhos conectados. Depois disso o robô **começa travado**: nada sai até o Gabriel mandar `/podeir` e tocar em **Liberar**.

## Comandos do Telegram (só o `TELEGRAM_CHAT_ID`)

`/podeir` prévia + Liberar/Cancelar · `/pausar` · `/retomar` · `/funil` · `/status`. Se o número for bloqueado, `/retomar` recusa; só `/retomar forcar`, depois de decisão dos sócios.

## Testar

```bash
npm test          # vitest: relógio falso, WhatsApp e Telegram falsos; nada fala com o mundo real
npm run typecheck
```

### Ponta a ponta (parte 2, DevOps)

`MODO_TESTE=1` usa `config/campanha-teste.json` e `funil-teste.sqlite`, e liga a escala de tempo (1 dia = 2 min, espera de 5 a 20 s, sem janela de horário nem feriado). Preencha antes o `telefone` da clínica de teste (só dígitos, com 55; número pessoal de um sócio). O robô recusa subir com o telefone vazio. `ESCALA_TEMPO=0` desliga a escala; a escala nunca vale fora do `MODO_TESTE`.

## Travas no código

- Só envia para JID que está em `campanha.json` (`src/seguro.ts`); grupos e outros contatos são ignorados.
- Idempotência: cada envio tem a chave `clinica:tipo`, gravada antes de enviar. Reiniciar não repete.
- Pausa total em `loggedOut`/401/403; não reconecta com outra sessão.
- Na dúvida, escala para o Gabriel.
