import { db } from '../../db.server'
import { criarEmissorAsaas, lerConfigAsaas } from './asaas'
import { criarEmissorFalso, pdfUrlFalso, xmlUrlFalso } from './fake'
import {
  type CobrancaRegistro,
  type CobrancaStore,
  type FluxoDeps,
  type Notificador,
  processarEvento,
} from './fluxo'
import type { EmissorFiscal } from './tipos'
import { tokenConfere } from './token'

// Server-side. Liga o fluxo ao banco e ao "WhatsApp" da demo (mensagens da conversa).

let emissorFalsoUnico: EmissorFiscal | null = null

export function emissorEmModoFalso(): boolean {
  return lerConfigAsaas(process.env) === null
}

export function obterEmissor(): EmissorFiscal {
  const config = lerConfigAsaas(process.env)
  if (config) {
    return criarEmissorAsaas(config)
  }
  emissorFalsoUnico ??= criarEmissorFalso()
  return emissorFalsoUnico
}

function paraRegistro(c: {
  id: string
  conversationId: string
  paymentId: string
  notaId: string | null
  servicoChave: string
  valorCentavos: number
  status: string
}): CobrancaRegistro {
  return { ...c, status: c.status as CobrancaRegistro['status'] }
}

const store: CobrancaStore = {
  async criar(dados) {
    return paraRegistro(await db.cobranca.create({ data: dados }))
  },
  async buscarPorPagamento(paymentId) {
    const c = await db.cobranca.findUnique({ where: { paymentId } })
    return c ? paraRegistro(c) : null
  },
  async buscarPorNota(notaId) {
    const c = await db.cobranca.findUnique({ where: { notaId } })
    return c ? paraRegistro(c) : null
  },
  async marcarEmEmissao(id) {
    const r = await db.cobranca.updateMany({
      where: { id, status: 'aguardando_pagamento' },
      data: { status: 'nota_em_emissao' },
    })
    return r.count === 1
  },
  async atualizar(id, patch) {
    await db.cobranca.update({ where: { id }, data: patch })
  },
}

const notificador: Notificador = {
  async paraPaciente(conversationId, texto) {
    await db.message.create({ data: { conversationId, role: 'assistant', content: texto } })
  },
  async paraRecepcao(conversationId, texto, opts) {
    await db.message.create({
      data: { conversationId, role: 'system', content: `[Aviso para a recepção] ${texto}` },
    })
    if (opts?.chamarHumano) {
      const motivo = opts.motivo ?? 'nota_rejeitada'
      await db.conversation.update({
        where: { id: conversationId },
        data: { status: 'needs_human' },
      })
      await db.handoffEvent.create({
        data: { conversationId, reason: motivo, message: texto },
      })
    }
  },
}

export function criarDeps(): FluxoDeps {
  return {
    emissor: obterEmissor(),
    store,
    notificador,
    log: (msg, dado) => console.warn(`[nota] ${msg}`, dado ?? ''),
  }
}

export function tokenWebhookValido(recebido: string | null): boolean {
  return tokenConfere(recebido, process.env.ASAAS_WEBHOOK_TOKEN)
}

export class SemCobrancaError extends Error {
  constructor() {
    super('Nenhuma cobrança aguardando pagamento')
  }
}

export async function temCobrancaAguardando(conversationId: string): Promise<boolean> {
  return (
    (await db.cobranca.count({ where: { conversationId, status: 'aguardando_pagamento' } })) > 0
  )
}

export type ResultadoSimulado = 'autorizada' | 'rejeitada' | 'rejeitada_sem_motivo'

/** Só no modo falso: faz o papel do Asaas (pagamento e resposta da prefeitura). */
export async function simularPagamentoENota(
  conversationId: string,
  resultado: ResultadoSimulado,
): Promise<void> {
  if (!emissorEmModoFalso()) {
    throw new Error('Simulação só existe sem ASAAS_API_KEY')
  }
  const cobranca = await db.cobranca.findFirst({
    where: { conversationId, status: 'aguardando_pagamento' },
    orderBy: { createdAt: 'desc' },
  })
  if (!cobranca) {
    throw new SemCobrancaError()
  }
  const deps = criarDeps()
  const evPag = deps.emissor.tratarWebhook({
    event: 'PAYMENT_RECEIVED',
    payment: { id: cobranca.paymentId },
  })
  if (evPag) {
    await processarEvento(evPag, deps)
  }
  const atual = await db.cobranca.findUnique({ where: { id: cobranca.id } })
  if (!atual?.notaId) {
    return
  }
  const invoice =
    resultado === 'autorizada'
      ? { id: atual.notaId, pdfUrl: pdfUrlFalso(atual.notaId), xmlUrl: xmlUrlFalso(atual.notaId) }
      : {
          id: atual.notaId,
          statusDescription:
            resultado === 'rejeitada' ? 'Código de serviço não habilitado para o município' : '',
        }
  const evNota = deps.emissor.tratarWebhook({
    event: resultado === 'autorizada' ? 'INVOICE_AUTHORIZED' : 'INVOICE_ERROR',
    invoice,
  })
  if (evNota) {
    await processarEvento(evNota, deps)
  }
}
