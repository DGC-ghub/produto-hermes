// Envio de e-mail transacional (marco M2.6). Usa a API do Resend via fetch — sem lib nova na
// stack. Sem RESEND_API_KEY no ambiente, cai em modo LOG (não envia, só registra): seguro pra
// dev e pra rodar antes de plugar a chave. Server-side.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export type SendEmailInput = { to: string; subject: string; html: string }

export async function sendEmail(input: SendEmailInput): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'Hermes <onboarding@resend.dev>'

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
