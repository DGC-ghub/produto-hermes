# Ligar o Mercado Pago (marco M3)

O código da cobrança está pronto (`/assinar` → checkout do MP; `/webhook/mercadopago` recebe a
confirmação). Falta só **plugar a conta do dono**. Sem isso, o botão "Assinar" mostra um aviso
de "pagamento indisponível" e nada é cobrado — nada quebra.

## O que o dono faz (uma vez)

1. **Conta Mercado Pago** — criar/entrar em [mercadopago.com.br](https://www.mercadopago.com.br)
   (conta de vendedor / empresa).
2. **Access Token** — no painel de desenvolvedores
   ([Suas integrações](https://www.mercadopago.com.br/developers/panel)) → criar uma aplicação →
   copiar o **Access Token de produção** (começa com `APP_USR-...`). Pra testar antes, dá pra usar
   as **credenciais de teste**.
3. **Colocar no `.env`** do servidor (⚠️ nunca no chat/código):
   ```
   MP_ACCESS_TOKEN=APP_USR-xxxxxxxx
   ```
4. **Configurar a URL do webhook** no painel do MP (Webhooks/Notificações), apontando pra:
   ```
   https://<dominio-publico-do-hermes>/webhook/mercadopago
   ```
   Evento: **Assinaturas (preapproval)**.

## Como funciona depois de ligado

1. Dono entra em **/assinar** e clica no plano → o Hermes cria uma assinatura (`preapproval`) no MP
   e redireciona pro **checkout do MP** (Pix, cartão ou boleto).
2. Cliente paga → o MP chama **/webhook/mercadopago** → o Hermes busca o estado real no MP e
   atualiza a `Subscription` (status `active`).
3. `isSubscriptionActive(tenantId)` passa a devolver `true`. O **gate** que bloqueia o atendimento
   quando a assinatura não está ativa entra junto com o **M4** (quando o WhatsApp é plugado).

## Planos (em código — `app/lib/subscription.server.ts`)
- **Essencial** — R$ 149/mês
- **Pro** — R$ 299/mês

Pra mudar preço/nome, editar `PLANS`. (Um catálogo no banco fica pra quando houver muitos planos.)

## Segurança do webhook (backlog)
Hoje o webhook aceita qualquer POST e busca a verdade no MP (o sync só afeta um `preapproval` que
já conhecemos, então é seguro contra lixo). Pra endurecer: validar a assinatura `x-signature` que
o MP manda — fica pra antes de escalar.
