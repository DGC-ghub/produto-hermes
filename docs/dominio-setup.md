# Ligar o domínio próprio

Guia de uma sentada. Tudo que precisa ser preenchido está marcado como **`COLAR AQUI`**.
Depois de terminar, três coisas passam a funcionar: e-mail chegando em cliente de
verdade, homologação da conta do Mercado Pago e os documentos legais completos.

Ordem importa: o passo 2 depende do 1, e o 4 depende do 2.

---

## 0. Registrar

Em [registro.br](https://registro.br) — aceita CPF, não exige CNPJ. Custa em torno de
R$ 40/ano.

Dois cuidados na escolha do nome:

- **Não use `hermes` sozinho.** A Hermès (maison francesa) defende a marca de forma
  agressiva. Setor diferente ajuda, mas você não quer descobrir isso depois de
  homologar o Mercado Pago e mandar mil e-mails. Um nome composto resolve.
- **Nunca use `whats` ou `whatsapp`** no domínio nem no endereço de e-mail. A Meta
  derruba sem aviso.

---

## 1. Apontar o domínio para o Hermes

O app hoje é servido pelo funnel do Tailscale em
`https://cryptobot.tail04b4ef.ts.net`. Duas saídas:

- **Manter no Pi:** apontar o domínio para o funnel (`CNAME`) ou para o IP público, se
  houver. Simples, mas amarra o produto à sua casa — queda de luz derruba cliente.
- **Mover para um host:** VPS pequena resolve. Nesse caso o `DATABASE_URL`, o
  `deploy/release.sh` e o backup precisam ir junto — me chame que eu conduzo.

Enquanto o DNS não propaga (pode levar horas), nada quebra: o funnel continua no ar.

---

## 2. Verificar o domínio no Resend

É isto que faz o e-mail chegar em alguém além de você.

1. [resend.com](https://resend.com) → **Domains** → **Add Domain** → seu domínio.
2. O Resend mostra registros **DKIM** e **SPF**. Publique-os no DNS do registro.br.
3. Espere ficar **Verified** (minutos a algumas horas).

---

## 3. Preencher a identificação legal

Arquivo: **`app/lib/legal.ts`** — é o único lugar. As páginas `/termos` e
`/privacidade` leem tudo de lá e destacam em amarelo o que ainda não foi preenchido.

```ts
export const LEGAL_ENTITY = {
  nome:            'COLAR AQUI',  // seu nome completo (ou razão social, se abrir CNPJ)
  documento:       'COLAR AQUI',  // seu CPF (ou CNPJ)
  endereco:        'COLAR AQUI',  // endereço completo, cidade e UF
  email:           'COLAR AQUI',  // ex.: contato@seudominio.com.br
  encarregado:     'COLAR AQUI',  // pode ser você mesmo
  emailEncarregado:'COLAR AQUI',  // ex.: privacidade@seudominio.com.br
  foro:            'COLAR AQUI',  // sua comarca, ex.: 'Goiânia, GO'
  hospedagem:      'COLAR AQUI',  // onde roda hoje, ex.: 'servidor próprio no Brasil'
}
```

Sobre o **encarregado (DPO)**: a LGPD exige um responsável por pedidos de titular. Pode
ser você. Não precisa de certificação nem de empresa.

---

## 4. Configurar o ambiente de produção

Arquivo: **`/home/pi/hermes-deploy/shared/.env`** — é a fonte da verdade em produção,
**não** o `.env` do repositório.

```bash
APP_URL="https://COLAR-AQUI.com.br"
EMAIL_FROM="Hermes <contato@COLAR-AQUI.com.br>"
```

Sobre o `APP_URL`: sem ele, o link dentro dos e-mails é montado com o host que chegou
no servidor — atrás de proxy isso pode virar `localhost:5173`, e o cliente recebe um
link que não abre. Como o envio responde "sucesso" mesmo assim, o problema é invisível:
a pessoa só não volta. **Precisa do `https://`**; se estiver malformado o servidor
avisa no log e usa o endereço da requisição como reserva.

Depois de editar:

```bash
systemctl --user restart hermes
```

---

## 5. Conferir que funcionou

```bash
journalctl --user -u hermes -n 30 --no-pager | grep -i "remetente de teste"
```

Se **aparecer** alguma linha, o `EMAIL_FROM` ainda está no remetente de teste — os
e-mails continuam sem chegar em cliente. Se **não aparecer nada**, está valendo.

Teste de ponta a ponta, que é o que importa:

1. Abra `/esqueci-senha` e peça o link para um e-mail seu **que não seja o da conta
   Resend** (um Gmail qualquer serve).
2. O e-mail tem que chegar, e o link tem que apontar para o seu domínio — não para
   `localhost`.
3. Clicar deve abrir a tela de redefinir senha.

Se o e-mail não chegar, veja no painel do Resend em **Logs**: ele mostra se foi aceito,
recusado ou barrado por falta de verificação de domínio.

---

## 6. Destravar o Mercado Pago

Com o domínio de pé e `/termos` e `/privacidade` publicados, a homologação da conta
deixa de ser bloqueada por falta de documentos.

Ainda falta, e **é código** (me chame quando chegar aqui):

- O `payerEmail` mandado ao MP hoje é o e-mail de login, e as contas antigas usam
  domínios inexistentes (`@migrado.local`, `@teste.local`) — o MP recusa com
  `400 Both payer and collector must be real or test users`.
- O pagador **não pode ser o dono da conta vendedora**: testar com o seu próprio
  e-mail falha pelo mesmo erro, mesmo com tudo certo.
- Falta `MP_WEBHOOK_SECRET` no `shared/.env` — sem ele o webhook rejeita 100% das
  notificações (fail-closed, por segurança).

⚠️ **Não ligue `BILLING_GATE_ENABLED`** antes de resolver o webhook: ele grava o status
da assinatura mas nunca renova a data de vencimento, então o gate bloquearia justamente
quem está pagando, a partir do 15º dia.
