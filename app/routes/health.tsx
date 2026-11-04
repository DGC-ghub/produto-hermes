// Sonda de vida para um monitor EXTERNO ao Pi.
//
// Motivo: o processo já caiu sem nada alarmar — quem está dentro da máquina não avisa que
// a máquina morreu. Um serviço de fora (UptimeRobot e afins) bate aqui de minuto em minuto
// e alarma quando para de responder.
//
// É PÚBLICA de propósito: monitor externo gratuito não carrega credencial. Por isso ela não
// diz nada além de vivo/doente — sem versão, sem contagem, sem nome de tenant, sem detalhe
// do erro. Quem responde 200 aqui provou duas coisas: o processo aceita conexão E o banco
// responde. Um app de pé com o banco travado é indistinguível de um app morto para o
// cliente, e por isso conta como fora do ar.

import { db } from '../db.server'

function responder(status: 'ok' | 'degraded') {
  return new Response(JSON.stringify({ status }), {
    status: status === 'ok' ? 200 : 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Saúde é sempre "agora": um proxy que cacheie isto mente para o monitor.
      'Cache-Control': 'no-store',
    },
  })
}

export async function loader() {
  try {
    // Consulta mínima: prova que o arquivo abre e o lock não está preso, sem ler dado algum.
    await db.$queryRaw`SELECT 1`
    return responder('ok')
  } catch {
    // O detalhe do erro fica no log do serviço, nunca na resposta pública.
    return responder('degraded')
  }
}
