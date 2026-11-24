import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { TransbordoConfig } from './attendant/tenant-config'
import { matchesAnyTrigger } from './handoff'

// Registro de transbordo (passa para o sócio) em ARQUIVO, para a demo antes do canal real.
// Uma linha JSON por evento em `<pasta>/<slug>.jsonl`. O cartão no Paperclip vem na tarefa do
// canal; o formato já traz o que o cartão precisa (resumo e resposta recomendada).

const SAFE_SLUG = /^[a-z0-9-]+$/
const ULTIMAS_FALAS = 6
const MAX_TRECHO = 280

type Fala = { role: 'user' | 'assistant'; content: string }

export type Transbordo = {
  criadoEm: string
  tenantSlug: string
  conversationId: string
  motivo: string
  resumo: string
  respostaRecomendada: string
}

/** Tapa CPF, e-mail e telefone antes de gravar. A demo é fictícia, mas o log não aprende a vazar. */
export function ocultarDadosPessoais(texto: string): string {
  return texto
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[oculto]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[oculto]')
    .replace(/(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, '[oculto]')
}

function trecho(texto: string): string {
  const limpo = ocultarDadosPessoais(texto).replace(/\s+/g, ' ').trim()
  return limpo.length > MAX_TRECHO ? `${limpo.slice(0, MAX_TRECHO)}…` : limpo
}

export type EntradaTransbordo = {
  config: TransbordoConfig
  tenantSlug: string
  conversationId: string
  motivo: string
  /** A mensagem que causou o transbordo. */
  mensagem: string
  /** Falas anteriores da conversa (sem a mensagem nova). */
  historico: Fala[]
  agora?: Date
}

/** Monta o registro (puro): resumo curto da conversa e a resposta que recomendamos ao sócio. */
export function montarTransbordo(entrada: EntradaTransbordo): Transbordo {
  const falas = [...entrada.historico, { role: 'user' as const, content: entrada.mensagem }]
    .slice(-ULTIMAS_FALAS)
    .map((fala) => `${fala.role === 'user' ? 'Clínica' : 'Agente'}: ${trecho(fala.content)}`)
  const recomendada =
    entrada.config.recomendacoes.find((item) => matchesAnyTrigger(entrada.mensagem, item.triggers))
      ?.resposta ?? entrada.config.respostaPadrao
  return {
    criadoEm: (entrada.agora ?? new Date()).toISOString(),
    tenantSlug: entrada.tenantSlug,
    conversationId: entrada.conversationId,
    motivo: entrada.motivo,
    resumo: falas.join('\n'),
    respostaRecomendada: recomendada,
  }
}

export function pastaDosTransbordos(): string {
  return process.env.HERMES_TRANSBORDO_DIR?.trim() || join(process.cwd(), 'data', 'transbordos')
}

/** Grava o transbordo. Config desligada não grava. Slug fora do padrão é recusado. */
export async function registrarTransbordo(
  entrada: EntradaTransbordo & { diretorio?: string },
): Promise<void> {
  if (!entrada.config.enabled) {
    return
  }
  if (!SAFE_SLUG.test(entrada.tenantSlug)) {
    throw new Error(`Invalid tenant slug: ${entrada.tenantSlug}`)
  }
  const pasta = entrada.diretorio ?? pastaDosTransbordos()
  await mkdir(pasta, { recursive: true })
  const linha = `${JSON.stringify(montarTransbordo(entrada))}\n`
  await appendFile(join(pasta, `${entrada.tenantSlug}.jsonl`), linha, 'utf8')
}
