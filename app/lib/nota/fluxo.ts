import { mensagemNotaPaciente, mensagemPix, motivoRejeicaoParaRecepcao } from './mensagens'
import { buscarServico } from './servicos'
import type { EmissorFiscal, EventoFiscal } from './tipos'

export type StatusCobranca =
  | 'aguardando_pagamento'
  | 'nota_em_emissao'
  | 'nota_autorizada'
  | 'nota_rejeitada'
  | 'erro'

export type CobrancaRegistro = {
  id: string
  conversationId: string
  paymentId: string
  notaId: string | null
  servicoChave: string
  valorCentavos: number
  status: StatusCobranca
}

// Portas: o banco e o "WhatsApp" entram por aqui, então o fluxo roda em teste sem nada real.
export interface CobrancaStore {
  criar(dados: Omit<CobrancaRegistro, 'id' | 'notaId' | 'status'>): Promise<CobrancaRegistro>
  buscarPorPagamento(paymentId: string): Promise<CobrancaRegistro | null>
  buscarPorNota(notaId: string): Promise<CobrancaRegistro | null>
  /** Transição atômica aguardando_pagamento → nota_em_emissao. true só para quem ganhou. */
  marcarEmEmissao(id: string): Promise<boolean>
  atualizar(
    id: string,
    patch: Partial<Pick<CobrancaRegistro, 'notaId' | 'status'>> & {
      pdfUrl?: string
      xmlUrl?: string
      motivo?: string
    },
  ): Promise<void>
}

export interface Notificador {
  paraPaciente(conversationId: string, texto: string): Promise<void>
  paraRecepcao(
    conversationId: string,
    texto: string,
    opts?: { chamarHumano?: boolean; motivo?: 'nota_rejeitada' | 'nota_falha_emissao' },
  ): Promise<void>
}

export type FluxoDeps = {
  emissor: EmissorFiscal
  store: CobrancaStore
  notificador: Notificador
  log?: (msg: string, dado?: unknown) => void
}

export type IniciarInput = {
  conversationId: string
  servicoChave: string
  valorCentavos: number
}

/** Passo 1: o atendimento terminou; gera o Pix de teste e manda ao paciente. */
export async function iniciarCobranca(
  input: IniciarInput,
  deps: FluxoDeps,
): Promise<CobrancaRegistro> {
  if (!Number.isInteger(input.valorCentavos) || input.valorCentavos <= 0) {
    throw new Error('Valor inválido')
  }
  const servico = buscarServico(input.servicoChave)
  if (!servico) {
    throw new Error(`Serviço desconhecido: ${input.servicoChave}`)
  }
  const pix = await deps.emissor.criarCobrancaPix({
    referencia: input.conversationId,
    valorCentavos: input.valorCentavos,
    descricao: servico.descricaoNota,
  })
  const registro = await deps.store.criar({
    conversationId: input.conversationId,
    paymentId: pix.id,
    servicoChave: servico.chave,
    valorCentavos: input.valorCentavos,
  })
  await deps.notificador.paraPaciente(
    input.conversationId,
    mensagemPix(input.valorCentavos, pix.pixCopiaECola),
  )
  return registro
}

/** Passos 2 a 4: reage aos eventos do emissor. Idempotente (webhook pode repetir). */
export async function processarEvento(evento: EventoFiscal, deps: FluxoDeps): Promise<void> {
  const { store, emissor, notificador } = deps

  if (evento.tipo === 'pagamento_recebido') {
    const cobranca = await store.buscarPorPagamento(evento.cobrancaId)
    if (!cobranca || cobranca.status !== 'aguardando_pagamento') {
      return
    }
    // Transição atômica antes de emitir: webhooks simultâneos iguais não emitem duas notas.
    if (!(await store.marcarEmEmissao(cobranca.id))) {
      return
    }
    const servico = buscarServico(cobranca.servicoChave)
    if (!servico) {
      await store.atualizar(cobranca.id, { status: 'erro' })
      return
    }
    try {
      const { notaId } = await emissor.emitirNota({
        cobrancaId: cobranca.paymentId,
        referencia: cobranca.conversationId,
        valorCentavos: cobranca.valorCentavos,
        servico,
      })
      await store.atualizar(cobranca.id, { notaId })
    } catch (erro) {
      deps.log?.('falha ao pedir a nota', erro instanceof Error ? erro.message : erro)
      await store.atualizar(cobranca.id, { status: 'erro', motivo: 'falha ao pedir a nota' })
      await notificador.paraRecepcao(
        cobranca.conversationId,
        'Não consegui pedir a nota ao emissor. Confira a conexão e tente de novo.',
        { chamarHumano: true, motivo: 'nota_falha_emissao' },
      )
    }
    return
  }

  const cobranca = await store.buscarPorNota(evento.notaId)
  if (!cobranca || cobranca.status !== 'nota_em_emissao') {
    return
  }

  if (evento.tipo === 'nota_autorizada') {
    await store.atualizar(cobranca.id, {
      status: 'nota_autorizada',
      pdfUrl: evento.pdfUrl,
      xmlUrl: evento.xmlUrl,
    })
    await notificador.paraPaciente(
      cobranca.conversationId,
      mensagemNotaPaciente(evento.pdfUrl, evento.xmlUrl),
    )
    return
  }

  // nota_rejeitada
  if (!evento.motivoBruto || evento.motivoBruto.trim() === '') {
    deps.log?.('nota rejeitada sem motivo, payload bruto', evento.payloadBruto)
  }
  const motivo = motivoRejeicaoParaRecepcao(evento.motivoBruto)
  await store.atualizar(cobranca.id, { status: 'nota_rejeitada', motivo })
  await notificador.paraRecepcao(cobranca.conversationId, motivo, { chamarHumano: true })
}
