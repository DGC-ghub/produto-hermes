// O que conta como artefato VÁLIDO. Um lugar só.
//
// Existe porque três consumidores precisam concordar: o processador, que produz; o claim da
// revisão, que decide se há o que revisar; e o simulador da etapa 6, que vai usar. Três
// interpretações de "válido" garantiriam que alguém assumisse uma revisão sobre material
// que o Hermes não consegue carregar.
//
// A validação é DETERMINÍSTICA e vai fundo o suficiente para responder a pergunta que
// importa: "o produto conseguiria usar isto?". Conferir só se o JSON parseia responde
// "existe um texto aqui", que é outra pergunta.
import { parseTenantConfig } from '../attendant/tenant-config'

/** Quantas perguntas de validação o job precisa produzir (spec §6.6). */
export const PERGUNTAS_ESPERADAS = 5

export type CampoDeArtefato =
  | 'candidateConfigJson'
  | 'candidateKnowledgeJson'
  | 'summaryJson'
  | 'gapsJson'
  | 'risksJson'
  | 'validationJson'

export const CAMPOS_DE_ARTEFATO: readonly CampoDeArtefato[] = [
  'candidateConfigJson',
  'candidateKnowledgeJson',
  'summaryJson',
  'gapsJson',
  'risksJson',
  'validationJson',
]

export type ProblemaDeArtefato = {
  campo: CampoDeArtefato
  /** Frase curta para o terminal. Diz o que fazer, não só que está errado. */
  motivo: string
}

export type ArtefatosBrutos = Partial<Record<CampoDeArtefato, string | null>>

/**
 * Confere todos os artefatos e devolve o que está errado.
 *
 * Lista de problemas, não booleano: quem está no terminal decide entre rodar o job de novo
 * e investigar, e para isso precisa saber O QUE falhou.
 */
export function validarArtefatos(
  tenantSlug: string,
  brutos: ArtefatosBrutos,
): ProblemaDeArtefato[] {
  const problemas: ProblemaDeArtefato[] = []
  for (const campo of CAMPOS_DE_ARTEFATO) {
    const motivo = conferir(tenantSlug, campo, brutos[campo])
    if (motivo !== null) {
      problemas.push({ campo, motivo })
    }
  }
  return problemas
}

function conferir(
  tenantSlug: string,
  campo: CampoDeArtefato,
  bruto: string | null | undefined,
): string | null {
  if (typeof bruto !== 'string' || bruto.trim().length === 0) {
    return 'ausente'
  }
  let valor: unknown
  try {
    valor = JSON.parse(bruto)
  } catch {
    return 'não é JSON válido'
  }

  switch (campo) {
    case 'candidateConfigJson':
      return conferirConfig(tenantSlug, valor)
    case 'candidateKnowledgeJson':
      return conferirConhecimento(valor)
    case 'validationJson':
      return conferirPerguntas(valor)
    case 'summaryJson':
      return conferirResumo(valor)
    case 'gapsJson':
    case 'risksJson':
      return conferirAchados(valor)
  }
}

/**
 * Monta a config FINAL a partir da candidata (spec §6.7).
 *
 * O agente produz somente conteúdo de NEGÓCIO. Os campos estruturais são construídos ou
 * forçados pelo servidor — `slug` e `knowledge.sourceDir` são os que existem hoje —, e é
 * de propósito: prompt injection no questionário não pode alterar para onde a base de
 * conhecimento aponta.
 *
 * Por isso a validação NÃO passa a candidata crua pelo parser: ela exigiria justamente os
 * campos que o agente não deve gerar. Valida-se o que o servidor vai montar.
 *
 * ⚠️ A §6.7 também manda o servidor forçar o conjunto de `tools` e seus `limits`. Isso
 * entra na etapa 6, junto do gerador, e tem que passar por AQUI — senão volta a haver duas
 * interpretações de "config final".
 */
export function montarConfigFinal(tenantSlug: string, candidata: unknown): unknown {
  if (typeof candidata !== 'object' || candidata === null || Array.isArray(candidata)) {
    return candidata
  }
  const raiz = candidata as Record<string, unknown>
  const conhecimento =
    typeof raiz.knowledge === 'object' && raiz.knowledge !== null
      ? (raiz.knowledge as Record<string, unknown>)
      : {}
  return {
    ...raiz,
    slug: tenantSlug,
    knowledge: { ...conhecimento, sourceDir: `knowledge/${tenantSlug}` },
  }
}

/**
 * A config precisa atravessar o MESMO parser que o motor usa.
 *
 * É o único jeito de responder "o Hermes conseguiria carregar isto?". Um objeto com um
 * campo qualquer passa por qualquer teste de forma e reprova aqui — faltam
 * `businessProfile`, `knowledge.sourcePolicy`, `guardrails`, `escalationPolicy`,
 * `objectives` e `tools`.
 */
function conferirConfig(tenantSlug: string, valor: unknown): string | null {
  try {
    parseTenantConfig(tenantSlug, montarConfigFinal(tenantSlug, valor))
    return null
  } catch (error) {
    // A mensagem do parser diz QUAL campo faltou, e é o que o terminal precisa mostrar.
    return `o motor não carregaria: ${error instanceof Error ? error.message : 'inválida'}`
  }
}

/** Documento de conhecimento: mesmo formato que `knowledge.server.ts` lê do disco. */
function conferirConhecimento(valor: unknown): string | null {
  if (!Array.isArray(valor)) {
    return 'deveria ser uma lista de documentos'
  }
  if (valor.length === 0) {
    // Base vazia é o caso que deixou três dos sete tenants sem nada: o motor não tem de
    // onde responder e cai no fallback em toda pergunta.
    return 'lista vazia — sem base de conhecimento o motor não tem de onde responder'
  }
  for (const [i, doc] of valor.entries()) {
    if (!textoPreenchido((doc as { title?: unknown })?.title)) {
      return `documento ${i + 1} sem título`
    }
    if (!textoPreenchido((doc as { content?: unknown })?.content)) {
      return `documento ${i + 1} sem conteúdo`
    }
  }
  return null
}

/**
 * As cinco perguntas, com o shape do §6.6.
 *
 * O número é fixo de propósito: são elas que provam a execução na etapa 7, e uma lista com
 * uma pergunta daria a aparência de prova sem cobrir nada.
 */
function conferirPerguntas(valor: unknown): string | null {
  if (!Array.isArray(valor)) {
    return 'deveria ser uma lista de perguntas'
  }
  if (valor.length !== PERGUNTAS_ESPERADAS) {
    return `são ${PERGUNTAS_ESPERADAS} perguntas (§6.6), veio ${valor.length}`
  }
  const ids = new Set<string>()
  for (const [i, pergunta] of valor.entries()) {
    const p = pergunta as Record<string, unknown>
    if (!textoPreenchido(p?.id)) {
      return `pergunta ${i + 1} sem id`
    }
    if (ids.has(p.id as string)) {
      // Id repetido faria duas marcações apontarem para a mesma linha na etapa 7.
      return `id "${p.id}" repetido`
    }
    ids.add(p.id as string)
    if (!textoPreenchido(p?.question)) {
      return `pergunta ${i + 1} sem enunciado`
    }
    if (!Array.isArray(p?.expectedFacts) || p.expectedFacts.length === 0) {
      return `pergunta ${i + 1} sem expectedFacts`
    }
    if (!p.expectedFacts.every(textoPreenchido)) {
      return `pergunta ${i + 1} com expectedFacts vazio`
    }
    if (!textoPreenchido(p?.expectedBehavior)) {
      return `pergunta ${i + 1} sem expectedBehavior`
    }
    if (typeof p?.shouldHandoff !== 'boolean') {
      // Ausente não é "false": a diferença entre "não sabemos" e "não deve escalar" é
      // exatamente o que a prova mede.
      return `pergunta ${i + 1} sem shouldHandoff booleano`
    }
  }
  return null
}

/**
 * O resumo mostrado ao cliente.
 *
 * ATENÇÃO: a spec cita o resumo mas NÃO fixa o formato dele. O contrato mínimo é este —
 * um objeto com `texto` preenchido —, e ele vale porque o resumo existe para ser lido por
 * uma pessoa: sem texto não há resumo. Acrescentar campos é compatível; este validador só
 * exige o que é indispensável, para não travar a etapa 6 num formato inventado aqui.
 */
function conferirResumo(valor: unknown): string | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    return 'deveria ser um objeto'
  }
  if (!textoPreenchido((valor as { texto?: unknown }).texto)) {
    return 'sem `texto` — é o que o cliente lê'
  }
  return null
}

/**
 * Lacunas e riscos.
 *
 * VAZIOS são resultado legítimo: significam "não encontrei nenhum". Exigir conteúdo
 * obrigaria o gerador a inventar problema para a revisão poder começar. Mas o que estiver
 * na lista precisa ter forma — item sem descrição não é achado, é ruído.
 */
function conferirAchados(valor: unknown): string | null {
  if (!Array.isArray(valor)) {
    return 'deveria ser uma lista (vazia é aceitável)'
  }
  for (const [i, item] of valor.entries()) {
    if (!textoPreenchido((item as { descricao?: unknown })?.descricao)) {
      return `item ${i + 1} sem descrição`
    }
  }
  return null
}

function textoPreenchido(valor: unknown): boolean {
  return typeof valor === 'string' && valor.trim().length > 0
}
