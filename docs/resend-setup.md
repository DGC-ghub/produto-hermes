# Ativar e-mail de verdade (Resend) — ~5 minutos

O Hermes manda um e-mail transacional: a **confirmação de cadastro** (o link que o novo
cliente clica pra confirmar o e-mail dele). Sem chave configurada, esse e-mail cai em
**modo log** (não sai). Este guia liga o envio de verdade com o **Resend** — grátis até
3.000 e-mails/mês, 100/dia.

## Passo a passo

1. **Criar conta**: acesse <https://resend.com> e crie uma conta (pode ser com o Google).
2. **Pegar a API key**: no painel, **API Keys → Create API Key**. Nome livre (ex.:
   `hermes-prod`), permissão **Sending access**. Copie a chave — começa com `re_`.
   ⚠️ Ela aparece **uma vez só**; se perder, gere outra.
3. **Colar no `.env`** do servidor (nunca no código, nunca no chat):
   ```
   RESEND_API_KEY="re_...cole_aqui..."
   ```
4. **Reiniciar** o serviço:
   ```
   systemctl --user restart hermes
   ```
5. **Testar de verdade**:
   ```
   npm run email:test -- SEU-EMAIL@gmail.com
   ```
   Deve chegar na sua caixa (confira o spam). Se chegou, está funcionando.

## ⚠️ Limitação do domínio de teste (importante)

Sem um **domínio próprio verificado**, o Resend só entrega e-mails para **o endereço dono
da conta Resend** (o seu). Ou seja: dá pra testar mandando pra você mesmo, mas ainda **não**
pra clientes de verdade — o Resend recusa outros destinatários.

Pra liberar envio pra qualquer um (produção), verifique um domínio:
**Resend → Domains → Add Domain**, e adicione os registros DNS que eles mostram (SPF/DKIM)
no seu provedor de domínio. Depois troque no `.env`:
```
EMAIL_FROM="Hermes <no-reply@seudominio.com.br>"
```
Isso é um passo posterior — entra junto com o **domínio próprio do produto** (marco M7).
Pra agora, o teste com o seu próprio Gmail já prova que o envio funciona.
