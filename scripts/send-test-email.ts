// Testa a chave do Resend DE VERDADE: dispara UM e-mail real para o destino informado.
// Carrega o .env automaticamente, então basta ter RESEND_API_KEY lá e rodar:
//   npm run email:test -- voce@gmail.com
// Sem a chave, cai no modo LOG do sendEmail (não envia) — e o script avisa.
import 'dotenv/config'
import { sendEmail } from '../app/lib/email.server'

const to = process.argv[2]
if (!to?.includes('@')) {
  console.error('Uso: npm run email:test -- <destino@email.com>')
  process.exit(1)
}

const hasKey = !!process.env.RESEND_API_KEY
console.log(
  `\n[email:test] RESEND_API_KEY: ${hasKey ? 'presente ✅' : 'AUSENTE ❌ (só loga, não envia)'}`,
)
console.log(
  `[email:test] Remetente:  ${process.env.EMAIL_FROM ?? 'Hermes <onboarding@resend.dev> (default)'}`,
)
console.log(`[email:test] Enviando para: ${to} ...\n`)

const r = await sendEmail({
  to,
  subject: 'Teste do Hermes ✔ — o envio de e-mail está funcionando',
  html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px">
    <h2 style="color:#166534">Deu certo! 🎉</h2>
    <p>Se você está lendo este e-mail, o envio transacional do <b>Hermes</b> está no ar.</p>
    <p style="color:#555">É o mesmo canal que manda a <b>confirmação de cadastro</b> para os seus clientes.</p>
  </div>`,
})

if (r.sent) {
  console.log(`✅ Resend aceitou o e-mail. Confira a caixa de entrada (e o spam) de ${to}.\n`)
  process.exit(0)
}
console.log('❌ Não enviou. Se a chave está presente, veja o erro do Resend logado acima.')
console.log(
  '   Lembrete: sem domínio verificado, o Resend SÓ entrega para o e-mail dono da conta.\n',
)
process.exit(1)
