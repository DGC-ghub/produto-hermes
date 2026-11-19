# Robô de vendas da DGC (agent bot do Chatwoot + Evolution API)

Manda a 1ª mensagem às clínicas da campanha, faz o acompanhamento (lembretes no 3º e no 7º dia útil) e passa ao Gabriel, **dentro do Chatwoot**, tudo o que for de venda. Plano: DGC-367 (v2). Roda **só na VM trabalhadora**, nunca na Pi.

```
WhatsApp ⇅ Evolution API ──▶ Chatwoot ──webhook──▶ robô (este serviço) ──▶ Telegram (8h, alertas, /pausar)
                 ▲                                      │ API do Chatwoot (nota, etiqueta, atribuição, status)
                 └──────── sendText / sendMedia ────────┘ SQLite (agendador e idempotência)
```

- **Envia** pela Evolution (`sendText` com `delay` = "digitando", `sendMedia` para o vídeo e o PDF). **Lê** pelo webhook do agent bot (só `message_created`; o que sai nunca vira ação, então não há loop).
- **Passar ao Gabriel** = nota privada com o rascunho + etiqueta `com-gabriel` + atribuição ao Gabriel + status `open`. **Nenhuma mensagem vai à clínica.**
- **Conversa de fora da campanha**: o robô não responde e põe `open`, sem atribuir.
- **Etiquetas** (funil): `1a-msg`, `respondeu`, `kit-enviado`, `com-gabriel`, `nao-quer` (robô), `conversa-marcada` (só humano), `robo-pausado` (humano; congela só aquela conversa).
- Com `com-gabriel`, `nao-quer` ou `robo-pausado`, o robô não escreve nada na conversa e cancela o que estava na fila dela. Se o Chatwoot não responder, ele também não escreve e tenta no ciclo seguinte.
- Telegram (grammy): resumo das 8h, alertas, lembrete das 4h comerciais e `/podeir`, `/pausar`, `/retomar`, `/status`, `/funil`.
- Código `.ts` roda direto no Node 24 (`node src/main.ts`), sem build. Estado: `node:sqlite`.
- Isolado do produto: pasta própria, `package.json` próprio. A infra (compose do Chatwoot e da Evolution) é da DGC-371, em `ferramentas/atendimento/`.

## O que NÃO foi provado ainda

Os testes usam adaptadores falsos. **Nada foi rodado contra uma Evolution ou um Chatwoot de verdade** (a infra da DGC-371 ainda não existia). A DGC-370 precisa confirmar:

1. A mensagem enviada pela Evolution aparece **uma vez só** no Chatwoot e não faz o webhook entrar em loop (spike da seção 2 do plano). Se der errado: plano B, respostas pela API do Chatwoot (`outgoing`) e só a 1ª pela Evolution; só muda `src/adaptador-evolution.ts`/`enviador.ts`.
2. O token do agent bot consegue pôr etiqueta, atribuir e mudar status. Se não conseguir, trocar por um token de agente com o mesmo `CHATWOOT_BOT_TOKEN`.
3. Os caminhos da Evolution v2 (`/chat/whatsappNumbers`, `/message/sendText`, `/message/sendMedia`, `/instance/fetchInstances` com `connectionStatus` e `disconnectionReasonCode`) e o remetente `user` das mensagens humanas no webhook.

## Instalar na VM

```bash
git clone -b feat/robo-vendas https://github.com/DGC-ghub/produto-hermes.git
cd produto-hermes/ferramentas/robo-vendas
export npm_config_store_dir=/home/dgc/.cache/pnpm-store
npm ci

mkdir -p ~/.config/dgc-atendimento ~/.local/share/dgc-atendimento/robo ~/.local/share/dgc-atendimento/midia
chmod 700 ~/.config/dgc-atendimento ~/.local/share/dgc-atendimento
install -m 600 /dev/null ~/.config/dgc-atendimento/robo.env   # veja as variáveis abaixo
# mídia: o vídeo v2 e os 10 PDFs (nome igual ao campo `pdf` de config/campanha.json)
cp ~/apps/robo-vendas-insumos/demo-recepcionista-ia-v2.mp4 ~/apps/robo-vendas-insumos/diagnosticos/*.pdf ~/.local/share/dgc-atendimento/midia/
```

## Onde ficam as coisas

| O quê | Onde |
|---|---|
| Segredos | `~/.config/dgc-atendimento/robo.env` (chmod 600) |
| Funil (SQLite) | `~/.local/share/dgc-atendimento/robo/funil.sqlite` (`DADOS_DIR` troca) |
| Mídia (vídeo e PDFs; fora do Git) | `MIDIA_DIR`, padrão `~/.local/share/dgc-atendimento/midia/` |
| Campanha (10 clínicas, textos, telefone e fonte) | `config/campanha.json` (no Git) |
| Campanha de teste (telefone vazio) | `config/campanha-teste.json` |

Variáveis do `robo.env` (nunca no Git, nunca em log):

| Variável | Para quê |
|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram (quem grava é o Gabriel) |
| `WEBHOOK_SECRET` | segredo do webhook (`?token=`), gerado pelo DevOps |
| `EVOLUTION_API_KEY` | chave da Evolution (`EVOLUTION_URL`, padrão `http://127.0.0.1:8080`; `EVOLUTION_INSTANCIA`, padrão `dgc`) |
| `CHATWOOT_BOT_TOKEN` | token do agent bot (`CHATWOOT_URL`, padrão `http://127.0.0.1:3000`; `CHATWOOT_CONTA`, padrão `1`) |
| `CHATWOOT_GABRIEL_ID` | id do agente Gabriel no Chatwoot (para as atribuições) |
| `WEBHOOK_PORTA` | padrão `8090`, sempre em `127.0.0.1` |

## Serviço `systemd --user`

`~/.config/systemd/user/dgc-robo-vendas.service`:

```ini
[Unit]
Description=Robô de vendas DGC
After=network-online.target

[Service]
WorkingDirectory=%h/produto-hermes/ferramentas/robo-vendas
EnvironmentFile=%h/.config/dgc-atendimento/robo.env
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

O robô **começa travado**: nada sai até o Gabriel mandar `/podeir` e tocar em **Liberar**.

## Ligar o agent bot à caixa (DevOps)

1. No Chatwoot (Configurações > Integrações > Bots de agente), criar o bot com a URL do webhook `http://127.0.0.1:8090/chatwoot?token=<WEBHOOK_SECRET>` e guardar o token dele em `CHATWOOT_BOT_TOKEN`.
2. Ligar o bot à caixa do WhatsApp **só depois** de o robô estar de pé; senão as conversas ficam presas em `pending`.
3. Anotar o id do agente Gabriel em `CHATWOOT_GABRIEL_ID`.

## Comandos do Telegram (só o `TELEGRAM_CHAT_ID`)

`/podeir` prévia + Liberar/Cancelar · `/pausar` · `/retomar` · `/funil` · `/status`. Se o número for bloqueado, `/retomar` recusa; só `/retomar forcar`, depois de decisão dos sócios.

## Testar

```bash
npm test          # vitest: relógio falso, Evolution, Chatwoot e Telegram falsos; nada fala com o mundo real
npm run typecheck
```

### Ponta a ponta (DGC-370, DevOps)

`MODO_TESTE=1` usa `config/campanha-teste.json` e `funil-teste.sqlite`, e liga a escala de tempo (1 dia = 2 min, espera de 5 a 20 s, sem janela de horário nem feriado). Preencha antes o `telefone` da clínica de teste (só dígitos, com 55; número pessoal de um sócio). O robô recusa subir com o telefone vazio. A escala nunca vale fora do `MODO_TESTE`.

## Travas no código

- Só envia para número que está em `campanha.json` (`src/seguro.ts`); grupos e outros contatos são ignorados.
- Idempotência: cada envio tem a chave `clinica:tipo`, gravada antes de enviar. Reiniciar não repete.
- Pausa total quando a Evolution mostra 401/403 (deslogado ou banido); não reconecta com outra sessão.
- Na dúvida, passa ao Gabriel.
