// Traduzir os artefatos da candidata para o que o motor consome. Puro.
//
// A parte que vai ao banco está em `preview.server.ts`; aqui fica só a conversão, que é
// onde mora a decisão sobre o NOME dos documentos.
import type { KnowledgeDocument } from '../knowledge.server'

/** Prefixo do nome sintético dos documentos da candidata. Ver `conhecimentoDaCandidata`. */
export const PREFIXO_DA_CANDIDATA = 'candidata'

/**
 * Identidade da conversa de teste sobre uma candidata (spec §10.3). Pura.
 *
 * `simulator:<conta>:<versão>:<geração>` — os quatro pedaços são todos necessários:
 *
 * - `accountId` separa dois sócios da mesma empresa, que testariam em cima um do outro;
 * - `setupVersionId` separa candidatas diferentes;
 * - `generation` é o que impede o histórico de um ciclo contaminar o teste do seguinte. Sem
 *   ele, a conversa da candidata reprovada continuaria viva na corrigida, e a pessoa
 *   avaliaria a nova resposta lendo o contexto da antiga (§3.5).
 *
 * NUNCA vem do cliente: `accountId` sai da sessão, os outros dois da versão resolvida.
 *
 * Distinta de `simulatorContactId` (rota `/testar-ia`), que identifica o teste sobre a config
 * PUBLICADA. São identidades diferentes de propósito — misturá-las juntaria, na mesma
 * conversa, o que a IA responde hoje e o que ela responderia se a candidata fosse publicada.
 * As duas convergem na etapa 8, quando o gate passa a escolher a fonte.
 */
export function contactIdDoPreview(
  accountId: string,
  setupVersionId: string,
  generation: number,
): string {
  return `simulator:${accountId}:${setupVersionId}:${generation}`
}

/**
 * Converte `candidateKnowledgeJson` para os documentos que o motor lê.
 *
 * O motor espera `KnowledgeDocument`, que tem `fileName` — a candidata não tem arquivo. O
 * nome é sintetizado, e é sintetizado dizendo `candidata-N.md` de propósito: esse nome
 * aparece nas FONTES mostradas junto da resposta, e é o que permite a quem revisa
 * distinguir "isto veio do material em revisão" de "isto veio da base que já está no ar".
 * Um nome neutro (`1.md`) esconderia justamente a informação pela qual o simulador existe.
 *
 * Lança quando a forma não serve. Em uso normal isso é impossível — `validarArtefatos`
 * roda antes —, e é exatamente por isso que a checagem fica: se algum dia alguém chamar
 * daqui sem validar, a falha é uma exceção alta e visível, não uma base de conhecimento
 * silenciosamente vazia que faria a IA responder "não sei" a tudo e parecer burra.
 */
export function conhecimentoDaCandidata(tenantSlug: string, docs: unknown): KnowledgeDocument[] {
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new Error('Conhecimento da candidata vazio ou não é lista — valide os artefatos antes.')
  }
  return docs.map((doc, i) => {
    const { title, content } = (doc ?? {}) as { title?: unknown; content?: unknown }
    if (typeof title !== 'string' || typeof content !== 'string') {
      throw new Error(`Documento ${i + 1} da candidata sem título ou conteúdo em texto.`)
    }
    return {
      tenantSlug,
      fileName: `${PREFIXO_DA_CANDIDATA}-${i + 1}.md`,
      title,
      content,
    }
  })
}
