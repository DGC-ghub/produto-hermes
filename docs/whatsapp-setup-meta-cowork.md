# Instruções para o Claude do navegador — configurar o WhatsApp na Meta

> **Para quem é este doc:** um agente Claude que opera o navegador do Gabriel (onde o
> Facebook/Meta já está logado). O objetivo é configurar o **WhatsApp Cloud API** e
> coletar 3 valores que o Gabriel vai repassar para o time técnico. O Gabriel **não
> sabe** mexer no Meta — você faz por ele, explicando cada passo.

---

## 📌 Escopo desta rodada (LEIA PRIMEIRO)

Os passos 1 a 4 **já foram feitos** (app criado, WhatsApp ligado, tokens coletados). Agora
faça **apenas os passos 5 e 6**: configurar o webhook com a URL abaixo e testar. A URL
pública já está no ar e respondendo. *(Se você for um agente novo e o app ainda não existir,
faça os passos 1 a 4 primeiro.)*

## Dados de configuração

- **Callback URL (webhook):** `https://stand-scouts-selective.ngrok-free.dev/webhook/whatsapp`
- **Token de verificação (Verify Token):** `hermes-webhook-2026`

---

## O que você vai me entregar no final (os 3 segredos)

1. **App Secret** (chave secreta do app)
2. **Access Token** (token de acesso do WhatsApp)
3. **Phone Number ID** (ID do número de telefone)

> ⚠️ **Segurança:** esses valores são senhas. **NÃO** poste em chat público, rede social,
> nem em nenhum site. Ao terminar, liste os 3 numa mensagem direta para o Gabriel e diga
> a ele para apagar depois de usar.

---

## Antes de começar
- Tire um **screenshot** / leia a tela antes de cada clique — o painel da Meta muda de
  layout e de idioma (PT/EN). Os nomes de botão abaixo vêm em **português (inglês)**.
- Se um botão tiver nome um pouco diferente, use o **mais parecido** e siga o sentido do
  passo. Em caso de dúvida real, descreva a tela ao Gabriel e pergunte.
- Tudo acontece em **developers.facebook.com** (o Facebook pessoal do Gabriel já está logado).

---

## Passo 1 — Criar o app
1. Abra **https://developers.facebook.com/apps/**
2. Clique em **Criar aplicativo** (*Create App*).
3. Em "caso de uso"/tipo, escolha **Outro** (*Other*) → **Avançar**, e depois **Empresa**
   (*Business*). Se aparecer direto uma lista de produtos, escolha o tipo **Empresa**.
4. Nome do app: `Hermes Atendimento` (ou similar). Email: o do Gabriel. Crie o app.
5. Se pedir senha do Facebook para confirmar, **peça ao Gabriel digitar** — não tente
   adivinhar a senha dele.

## Passo 2 — Adicionar o produto WhatsApp
1. No painel do app, ache o card **WhatsApp** e clique em **Configurar** (*Set up*).
2. Se pedir para vincular/criar uma **conta comercial** (Business Account), crie uma nova
   com o nome da empresa do Gabriel. Avance até abrir a tela de **API Setup** do WhatsApp.

## Passo 3 — Coletar Phone Number ID + Access Token (tela "API Setup")
Na tela **WhatsApp → Primeiros passos / API Setup**:
1. A Meta fornece um **número de teste grátis**. Localize e copie o **ID do número de
   telefone** (*Phone number ID*) — é um número longo. → guarde como **Phone Number ID**.
2. Copie o **Token de acesso temporário** (*Temporary access token*). → guarde como
   **Access Token**. *(Atenção: este token expira em ~24h; o time vai trocar por um
   permanente depois.)*
3. Na mesma tela, em "Para" (*To*) / destinatários, clique em **Gerenciar lista de números**
   e **adicione o número de WhatsApp pessoal do Gabriel** (peça o número a ele). A Meta
   manda um código de confirmação no WhatsApp dele — peça o código e confirme. *(Isso é o
   que permite testar recebendo no WhatsApp dele.)*

## Passo 4 — Coletar o App Secret
1. No menu lateral, vá em **Configurações do aplicativo** (*App settings*) → **Básico**
   (*Basic*).
2. No campo **Chave Secreta do Aplicativo** (*App Secret*), clique em **Mostrar** (*Show*)
   — pode pedir a senha do Facebook (peça ao Gabriel). Copie. → guarde como **App Secret**.

## Passo 5 — Configurar o webhook
> Só faça se a **Callback URL** (no topo deste doc) estiver preenchida.
1. Volte em **WhatsApp** → **Configuração** (*Configuration*).
2. Na seção **Webhook**, clique em **Editar** (*Edit*).
3. **URL de callback** (*Callback URL*): cole a **Callback URL** do topo deste doc.
4. **Token de verificação** (*Verify token*): digite exatamente `hermes-webhook-2026`.
5. Clique em **Verificar e salvar** (*Verify and save*). Deve dar certo (o servidor do
   Hermes responde ao desafio). Se der erro, a URL pública provavelmente não está no ar —
   **avise o Gabriel** (o time precisa ligar o servidor/túnel).
6. Ainda na seção Webhook, em **Campos do webhook** (*Webhook fields*), clique em
   **Gerenciar** e **assine** (*Subscribe*) o campo **messages**.

## Passo 6 — Teste rápido
1. Do **WhatsApp pessoal do Gabriel**, mande uma mensagem para o **número de teste**
   (aparece na tela de API Setup, passo 3).
2. Se tudo estiver ligado do lado técnico, o Hermes responde no WhatsApp dele em alguns
   segundos. Se não responder, não tem problema — pode ser que o servidor ainda não esteja
   no ar; o time conecta com os 3 valores que você coletou.

## Passo 7 — Entregar os valores
Mande para o Gabriel, numa mensagem direta, exatamente assim (preenchendo):
```
App Secret: ...
Access Token: ...
Phone Number ID: ...
Número de teste da Meta: ...
```
E lembre o Gabriel: **passar isso para o time técnico colocar no `.env`** e **não deixar
esses valores espalhados**.

---

## Resumo do que você fez
Criou o app na Meta, ligou o WhatsApp, pegou o número de teste, configurou o webhook
(`hermes-webhook-2026`) apontando para o servidor do Hermes, assinou o evento `messages`, e
coletou os 3 segredos. Com eles no `.env`, mensagens reais do WhatsApp passam a ser
atendidas pela IA do Hermes.
