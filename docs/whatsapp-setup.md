# WhatsApp oficial — passo a passo do setup (Meta Cloud API)

> O **código** do webhook já está pronto (`app/routes/webhook.whatsapp.tsx` +
> `app/lib/whatsapp.server.ts`). Falta o **setup na Meta** — que só você pode fazer.
> Quando preencher o `.env` e configurar o webhook, mensagens reais do WhatsApp
> entram no Hermes e ele responde. Visão/decisões: [`whatsapp-oficial-notas.md`](whatsapp-oficial-notas.md).

## O que o código já faz
- `GET /webhook/whatsapp` — handshake de verificação (a Meta valida a URL).
- `POST /webhook/whatsapp` — recebe mensagens, **valida a assinatura** (App Secret),
  resolve a empresa pelo número, chama o motor (`processIncomingMessage`) e responde
  pela Cloud API. `contactId` = telefone validado do canal (não do formulário).
- Provado localmente: GET/POST, validação de assinatura (401 se inválida) e o ciclo
  receber → processar → (enviar). Só o envio real depende do seu token.

## Passos na Meta (você faz)
1. **Conta + app**: crie um app em [developers.facebook.com](https://developers.facebook.com)
   (tipo "Business") e adicione o produto **WhatsApp**.
2. **Número de teste**: o painel do WhatsApp dá um **número de teste grátis**. Anote o
   **Phone number ID** e o **token de acesso temporário** (validade ~24h).
3. **App Secret**: em Configurações > Básico do app, copie o **App Secret**.
4. **Verify token**: invente uma string qualquer (ex.: `hermes-webhook-2026`). Ela é só
   um segredo compartilhado entre você e a Meta.

## Preencher o `.env`
```
WHATSAPP_VERIFY_TOKEN="hermes-webhook-2026"        # o que você inventou
WHATSAPP_APP_SECRET="<App Secret do app>"
WHATSAPP_ACCESS_TOKEN="<token de acesso>"
WHATSAPP_PHONE_NUMBER_ID="<Phone number ID>"
WHATSAPP_NUMBER_MAP="<Phone number ID>:assistencia-tecnica-demo"
```
> `WHATSAPP_NUMBER_MAP` liga o número à empresa. Formato: `phoneId:slug` (vários
> separados por vírgula). Reinicie o `npm run dev` depois de editar o `.env`.

## Configurar o webhook na Meta
1. No painel do WhatsApp > **Configuration** > Webhook, clique em **Edit**.
2. **Callback URL**: `https://cryptobot.tail04b4ef.ts.net:5173/webhook/whatsapp`
   (a URL pública do túnel; em produção, o domínio do servidor).
3. **Verify token**: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`.
4. Salve — a Meta chama o `GET` e valida (o código devolve o challenge).
5. **Subscribe** ao campo **`messages`**.

## Testar
- Mande uma mensagem do **seu WhatsApp pessoal** para o número de teste.
- Ela cai no webhook → o Hermes responde no seu WhatsApp.
- Para IA real nas respostas: `ATTENDANT_PROVIDER="claude_cli"` no `.env`.

## Limites e produção (importante)
- **Token temporário expira (~24h)** — para uso contínuo, gere um **token permanente**
  (System User) ou use um número/WABA de produção.
- **Janela de 24h**: fora dela, só dá para iniciar conversa com **template aprovado**
  (ver seção 7 das notas). Dentro da janela, resposta livre (o que o motor faz).
- **Custo por conversa** conforme a política da Meta — confirme na fonte antes de
  prometer preço (seção 8 das notas).
- **Produção**: trocar o processamento em background (fire-and-forget) por uma **fila**,
  e revisar a LGPD antes de tratar dados reais.
