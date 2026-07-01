# Como tirar a chave permanente do WhatsApp (passo a passo)

> **Por quê:** a chave (token) de acesso que a Meta dá por padrão é **temporária — vence
> em ~24h**. Pra o robô atender por dias sem parar, você precisa de uma chave **permanente**
> (feita por um "Usuário do sistema"). Faz uma vez, vale pra sempre.
>
> Isto é a **sua lição de casa** — só você tem acesso ao painel da Meta. Leva ~10 minutos.

---

## Antes de começar (você já deve ter)
- Uma **conta comercial** na Meta (business.facebook.com).
- O **app já criado** com o produto **WhatsApp** adicionado (foi o que você usou no 1º teste).
- O **Phone number ID** do número de teste (já está no seu `.env`).

Se tiver isso, siga. Se não lembrar, no painel do app em developers.facebook.com > WhatsApp
> "API Setup" você vê o número e o Phone number ID.

---

## Passo a passo

### 1. Abra as Configurações do Negócio
- Vá em **business.facebook.com**.
- No menu, entre em **Configurações do negócio** (Business Settings) — o ícone de engrenagem.

### 2. Crie um "Usuário do sistema"
- Na coluna da esquerda: **Usuários** > **Usuários do sistema** (System Users).
- Clique em **Adicionar** (Add).
- Dê um nome (ex.: `hermes-bot`) e escolha a função **Admin**.
- Confirme.

### 3. Dê acesso do app e do WhatsApp a esse usuário
- Com o `hermes-bot` selecionado, clique em **Adicionar ativos** (Add Assets).
- Em **Aplicativos**: marque o seu app e ligue a permissão de **controle total** (Manage).
- Em **Contas do WhatsApp** (WhatsApp Accounts): marque a sua conta do WhatsApp (WABA) e
  ligue **controle total**.
- Salve.

### 4. Gere a chave permanente
- Ainda no `hermes-bot`, clique em **Gerar novo token** (Generate New Token).
- Selecione o **seu app**.
- Em **Validade do token** (Token Expiration): escolha **Nunca** (Never). ← é isto que a
  torna permanente.
- Em **Permissões**, marque as duas:
  - `whatsapp_business_messaging`
  - `whatsapp_business_management`
- Clique em **Gerar token**.
- **Copie a chave** que aparecer. ⚠️ Ela só é mostrada **uma vez** — se fechar sem copiar,
  tem que gerar de novo.

---

## Onde colocar a chave (com segurança)

⚠️ **Não cole a chave em chat, e-mail ou WhatsApp.** Ela é como uma senha. Coloque direto no
arquivo `.env` do projeto, no Pi:

1. Abra o `.env` em `~/projects/produto-hermes/.env`.
2. Troque a linha do token pela chave nova:
   ```
   WHATSAPP_ACCESS_TOKEN="<cole aqui a chave permanente>"
   ```
3. Reinicie o serviço pra ele pegar a chave nova:
   ```
   export XDG_RUNTIME_DIR=/run/user/$(id -u)
   systemctl --user restart hermes
   ```

---

## Um detalhe do número de teste

O número **de teste** grátis da Meta só consegue **enviar mensagem para números que você
cadastrou** antes. No painel do app > WhatsApp > **API Setup**, em "To", adicione o **seu
número pessoal** de WhatsApp (ele manda um código de confirmação). Assim você consegue
testar o ciclo completo (você manda → robô responde no seu zap).

> Para um cliente de verdade atender **qualquer** número, aí sim entra um número de produção
> + verificação do negócio — mas isso é depois, não pro voo de teste.

---

## Como saber que deu certo
- Com a chave nova no `.env` e o serviço reiniciado, me chama.
- Eu ligo a **ponte pública** (funnel), você cola a URL no painel da Meta e manda uma
  mensagem de teste do seu WhatsApp.
- Se o robô responder no seu zap → **voo de teste no ar.** 🚀
