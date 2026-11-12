import { sendOperatorReply } from '../operator-reply.server'
import { desfazerPendencia, enviarConfirmacoes } from './registro'

/**
 * Botão da tela do operador. 1 mensagem por consulta de AMANHÃ, só para quem já marcou
 * (nada de disparo em massa). O operador clica; nada sai sozinho.
 */
export async function enviarConfirmacoesDeAmanha(
  op: { tenantId: string; tenantSlug: string; tenantName: string },
  now: string = new Date().toISOString(),
): Promise<{ enviadas: number; falhas: number }> {
  const lote = await enviarConfirmacoes(op.tenantSlug, op.tenantName, now)
  let enviadas = 0
  let falhas = 0
  for (const m of lote) {
    const r = await sendOperatorReply({
      tenantId: op.tenantId,
      tenantSlug: op.tenantSlug,
      contactId: m.patientRef,
      text: m.text,
    })
    // `ambiguous`: pode ter chegado. Mantém a pendência (não reenvia em dobro).
    if (r.ok || r.ambiguous) {
      enviadas += 1
    } else {
      desfazerPendencia(op.tenantSlug, m.patientRef)
      falhas += 1
    }
  }
  return { enviadas, falhas }
}
