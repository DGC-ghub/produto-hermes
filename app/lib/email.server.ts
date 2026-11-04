// Envio de e-mail transacional (marco M2.6). Usa a API do Resend via fetch — sem lib nova na
// stack. Sem RESEND_API_KEY no ambiente, cai em modo LOG (não envia, só registra): seguro pra
// dev e pra rodar antes de plugar a chave. Server-side.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

// Remetente de teste do Resend. Ele ACEITA o envio e responde sucesso, mas só entrega
// para o dono da conta Resend — para qualquer outro destinatário o e-mail simplesmente
// não chega, sem erro nenhum. É o motivo de confirmação de cadastro e redefinição de
// senha não funcionarem para cliente de verdade. Sai daqui assim que houver domínio
// próprio verificado no Resend: basta definir EMAIL_FROM.
const RESEND_TEST_FROM = 'Hermes <onboarding@resend.dev>'

export type SendEmailInput = { to: string; subject: string; html: string }

/** `true` enquanto o remetente for o de teste — só entrega para o dono da conta. */
export function isTestSender(from: string): boolean {
  return from.includes('@resend.dev')
}

export async function sendEmail(input: SendEmailInput): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? RESEND_TEST_FROM

  if (isTestSender(from)) {
    // Avisa a cada envio de propósito: o silêncio é exatamente o problema — sem isto,
    // "enviado com sucesso" no log convive com o cliente jurando que nada chegou.
    console.warn(
      `[email] remetente de teste (${from}) — "${input.subject}" só será entregue ao dono da conta Resend. Defina EMAIL_FROM com domínio próprio verificado.`,
    )
  }

  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY ausente — e-mail para ${input.to} NÃO enviado (stub): "${input.subject}"`,
    )
    return { sent: false }
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[email] falha ao enviar para ${input.to}: ${res.status} ${body}`)
      return { sent: false }
    }
    return { sent: true }
  } catch (error) {
    console.error(`[email] erro de rede ao enviar para ${input.to}`, error)
    return { sent: false }
  }
}
