// Assumir uma revisão interna: o claim atômico do §11.1.
//
// Só isso. Aprovar e pedir correção são comandos próprios, de etapas seguintes — misturar
// as três decisões num comando faria a pessoa aprovar sem ter aberto o material.
//
// O motivo de o claim existir: sem ele, dois revisores trabalham no mesmo material sem
// saber, e o segundo descobre quando o primeiro já mudou o estado. E o motivo das
// pré-condições: assumir antes de os artefatos existirem faria o relógio de 30 minutos
// medir ESPERA DO JOB, não trabalho humano.
import { db } from '../../db.server'
import { type ProblemaDeArtefato, validarArtefatos } from './artefatos'
import { comRetry } from './retry'
import { formatarAtor, normalizarReviewer, type ReviewerLido } from './revisao'

export type ResultadoDaRevisao =
  | {
      tipo: 'assumida'
      versionId: string
      generation: number
      reviewer: string
      submittedAt: Date | null
    }
  | { tipo: 'tenant_desconhecido' }
  /** Nenhuma versão em elaboração para este tenant. */
  | { tipo: 'nada_pendente' }
  | { tipo: 'estado_invalido'; estado: string }
  | { tipo: 'job_nao_concluido'; statusDoJob: string | null }
  | { tipo: 'artefatos_ausentes'; problemas: ProblemaDeArtefato[] }
  /** Publicaram depois da submissão: a candidata foi pensada sobre outra base (§4.8). */
  | { tipo: 'base_mudou' }
  /** Outro revisor chegou primeiro. */
  | { tipo: 'ja_assumida'; reviewer: string | null; desde: Date | null }
  /**
   * O nome do revisor não serve. A CLI já confere, mas a fronteira do SERVIDOR é a
   * autoridade: um teste, um worker ou um script futuro chamando esta função com `" "`
   * gravaria um claim com identidade inútil, e "quem assumiu?" ficaria sem resposta.
   */
  | { tipo: 'reviewer_invalido'; motivo: Extract<ReviewerLido, { ok: false }>['motivo'] }

/**
 * Assume a revisão da versão pendente de um tenant.
 *
 * Tudo numa transação: as pré-condições e o compare-and-swap precisam ver o mesmo estado.
 * Conferir fora e escrever depois deixaria a janela em que outro revisor assume no meio —
 * que é exatamente o que este comando existe para fechar.
 */
export async function assumirRevisao(input: {
  tenantSlug: string
  reviewer: string
  hostname: string
  /**
   * O usuário do processo (§11.2). Vai no detalhe do evento, ao lado do `actor`: o nome
   * digitado é declarado por quem roda o comando, e a conta do sistema é o que o sistema
   * observou. Quando as duas discordam, é isso que permite perguntar por quê.
   */
  usuarioDoProcesso: string
  agora?: Date
}): Promise<ResultadoDaRevisao> {
  const agora = input.agora ?? new Date()

  // ANTES de qualquer acesso ao banco: o nome é o que vai para a auditoria, e normalizar
  // aqui — não só na CLI — é o que torna a forma persistida decidida num lugar só.
  const lido = normalizarReviewer(input.reviewer)
  if (!lido.ok) {
    return { tipo: 'reviewer_invalido', motivo: lido.motivo }
  }
  const reviewer = lido.nome

  return comRetry((opcoes) =>
    db.$transaction(async (tx): Promise<ResultadoDaRevisao> => {
      const tenant = await tx.tenant.findUnique({
        where: { slug: input.tenantSlug },
        select: { id: true, slug: true },
      })
      if (!tenant) {
        return { tipo: 'tenant_desconhecido' }
      }

      const setup = await tx.aiSetup.findUnique({
        where: { tenantId: tenant.id },
        select: { id: true, reviewVersionId: true, publishedVersionId: true },
      })
      if (!setup?.reviewVersionId) {
        return { tipo: 'nada_pendente' }
      }

      const versao = await tx.aiSetupVersion.findFirst({
        where: { id: setup.reviewVersionId, tenantId: tenant.id, setupId: setup.id },
        select: {
          id: true,
          state: true,
          generation: true,
          submittedAt: true,
          basePublishedVersionId: true,
          reviewStartedAt: true,
          reviewer: true,
          candidateConfigJson: true,
          candidateKnowledgeJson: true,
          summaryJson: true,
          gapsJson: true,
          risksJson: true,
          validationJson: true,
        },
      })
      if (!versao) {
        return { tipo: 'nada_pendente' }
      }
      if (versao.state !== 'submitted') {
        return { tipo: 'estado_invalido', estado: versao.state }
      }

      // O job precisa ter TERMINADO nesta geração. Um job da geração anterior concluído
      // não diz nada sobre os artefatos que estão na linha agora.
      const job = await tx.aiSetupJob.findFirst({
        // `kind: 'generate'` é obrigatório: é o job da GERAÇÃO da candidata. Sem ele, um
        // job de outro tipo (ou corrompido) com `completed` satisfaria a pré-condição sem
        // provar que a geração terminou — e alguém assumiria a revisão de nada.
        where: {
          versionId: versao.id,
          tenantId: tenant.id,
          generation: versao.generation,
          kind: 'generate',
        },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      })
      if (job?.status !== 'completed') {
        return { tipo: 'job_nao_concluido', statusDoJob: job?.status ?? null }
      }

      // A config passa pelo MESMO parser do motor: é o único jeito de saber se o produto
      // conseguiria carregar o que o job produziu.
      const problemas = validarArtefatos(tenant.slug, versao)
      if (problemas.length > 0) {
        return { tipo: 'artefatos_ausentes', problemas }
      }

      // §4.8: publicaram entre a submissão e agora, então a candidata raciocinou sobre uma
      // configuração que já não é a vigente. Revisar isso aprovaria o desfazimento de uma
      // correção que já está no ar.
      if ((setup.publishedVersionId ?? null) !== versao.basePublishedVersionId) {
        return { tipo: 'base_mudou' }
      }

      const claim = await tx.aiSetupVersion.updateMany({
        // `reviewStartedAt: null` é o que torna o claim atômico: o segundo revisor encontra
        // a linha já marcada e conta 0.
        where: {
          id: versao.id,
          tenantId: tenant.id,
          state: 'submitted',
          reviewStartedAt: null,
        },
        data: { reviewStartedAt: agora, reviewer },
      })
      if (claim.count !== 1) {
        // Mostra QUEM assumiu: "conflito" sem nome faz a pessoa ficar tentando de novo.
        const dono = await tx.aiSetupVersion.findUnique({
          where: { id: versao.id },
          select: { reviewer: true, reviewStartedAt: true },
        })
        return {
          tipo: 'ja_assumida',
          reviewer: dono?.reviewer ?? null,
          desde: dono?.reviewStartedAt ?? null,
        }
      }

      await tx.aiSetupEvent.create({
        data: {
          tenantId: tenant.id,
          versionId: versao.id,
          kind: 'review_started',
          actor: formatarAtor(reviewer, input.hostname),
          // Estruturado e curto de propósito: `detail` não é depósito de texto livre nem
          // de ambiente. Só o que a auditoria precisa.
          detail: JSON.stringify({
            generation: versao.generation,
            processUser: limitarUsuario(input.usuarioDoProcesso),
          }),
        },
      })

      return {
        tipo: 'assumida',
        versionId: versao.id,
        generation: versao.generation,
        reviewer,
        submittedAt: versao.submittedAt,
      }
    }, opcoes),
  )
}

/** Limite do nome de usuário gravado. Conta de sistema não tem nome de 200 caracteres. */
const USUARIO_MAX_CHARS = 64

/**
 * Recorta o usuário do processo para o que cabe num registro de auditoria.
 *
 * Vem de `userInfo().username`, mas é tratado como entrada: um valor estranho (vindo de
 * ambiente exótico ou de container mal configurado) não vira texto arbitrário no banco.
 */
function limitarUsuario(bruto: string): string {
  const limpo = bruto.trim().replace(/\s+/g, ' ').slice(0, USUARIO_MAX_CHARS)
  return limpo.length > 0 ? limpo : 'desconhecido'
}

/**
 * O que o comando mostra ANTES de agir, e o que o `--sim` mostra em vez de agir.
 *
 * Somente leitura. A spec (§11) exige que nenhum comando aja sem imprimir slug, versão,
 * geração, estado e reviewer — isto é o que alimenta essa impressão.
 */
export async function olharRevisao(tenantSlug: string) {
  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, name: true, slug: true },
  })
  if (!tenant) {
    return null
  }
  const setup = await db.aiSetup.findUnique({
    where: { tenantId: tenant.id },
    select: { id: true, reviewVersionId: true, publishedVersionId: true },
  })
  if (!setup?.reviewVersionId) {
    return { tenant, versao: null }
  }
  const versao = await db.aiSetupVersion.findFirst({
    where: { id: setup.reviewVersionId, tenantId: tenant.id, setupId: setup.id },
    select: {
      id: true,
      state: true,
      generation: true,
      submittedAt: true,
      basePublishedVersionId: true,
      reviewStartedAt: true,
      reviewer: true,
      changesRequested: true,
      candidateConfigJson: true,
      candidateKnowledgeJson: true,
      summaryJson: true,
      gapsJson: true,
      risksJson: true,
      validationJson: true,
    },
  })
  if (!versao) {
    return { tenant, versao: null }
  }
  const job = await db.aiSetupJob.findFirst({
    where: {
      versionId: versao.id,
      tenantId: tenant.id,
      generation: versao.generation,
      kind: 'generate',
    },
    orderBy: { createdAt: 'desc' },
    select: { status: true, failureKind: true, lastError: true },
  })
  return {
    tenant,
    versao,
    job,
    problemas: validarArtefatos(tenant.slug, versao),
    baseValida: (setup.publishedVersionId ?? null) === versao.basePublishedVersionId,
  }
}
