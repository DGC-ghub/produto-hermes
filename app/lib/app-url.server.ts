// De onde sai o endereço público do Hermes — o que vira LINK dentro dos e-mails
// (confirmação de cadastro, redefinição de senha).
//
// Por que não basta `new URL(request.url).origin`: o app roda atrás de um proxy
// (hoje o funnel do Tailscale, amanhã o domínio próprio). O que o Express enxerga
// é o host da conexão que chegou nele, que pode ser `localhost:5173` — e um link
// de redefinir senha apontando pra localhost não abre na máquina de ninguém.
// Um e-mail com link quebrado não dá erro em lugar nenhum: o cliente só não volta.
//
// Por isso APP_URL, quando existe, MANDA. O origin do request fica de reserva
// pra dev, onde não há proxy e o host é o certo.

/** Tira a barra final pra não gerar link com `//` no meio. Pura. */
function normalize(base: string): string {
  return base.replace(/\/+$/, '')
}

/**
 * A URL é utilizável como base de link? Exige http(s) e host — protege contra um
 * APP_URL digitado errado (`hermesatende.com.br`, sem esquema) virar link inválido
 * em todos os e-mails silenciosamente. Pura.
 */
export function isUsableAppUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.host.length > 0
  } catch {
    return false
  }
}

/**
 * Escolhe a base dos links, dando precedência ao que foi configurado. Pura — recebe
 * o env em vez de ler `process.env`, o que deixa os dois caminhos testáveis.
 */
export function pickAppUrl(configured: string | undefined, requestOrigin: string): string {
  if (configured && isUsableAppUrl(configured)) {
    return normalize(configured)
  }
  if (configured) {
    // Configurado mas inválido é pior que ausente: o dono acha que apontou o domínio
    // e os e-mails saem com link quebrado. Avisa alto e usa o request como reserva.
    console.error(
      `[app-url] APP_URL inválida ("${configured}") — precisa incluir o esquema, ex.: https://exemplo.com.br. Usando o endereço da requisição.`,
    )
  }
  return normalize(requestOrigin)
}

/** Base pública para montar links de e-mail. Server-side. */
export function appUrlFor(request: Request): string {
  return pickAppUrl(process.env.APP_URL, new URL(request.url).origin)
}
