// Executar a candidata no simulador do dono (`owner_preview`, spec §7.2 e §10.3).
//
// Junta as três peças e não decide nada por conta própria: a sessão diz de quem é o tenant,
// `resolverFonteDoPreview` diz se pode e com qual material, e o motor responde. O que este
// módulo acrescenta são duas fronteiras:
//
//  1. AUTORIDADE. O tipo de entrada NÃO TEM campo de tenant. Não é convenção, é o tipo: quem
//     chama não tem por onde passar um tenant, e o único lugar de onde ele sai é a sessão
//     autenticada. Um `tenantSlug` no corpo do POST é dado morto.
//  2. TRADUÇÃO. As recusas internas viram uma orientação em português e um CÓDIGO FIXO. O
//     cliente nunca lê "ponteiro incoerente" nem por que a linha está estranha: isso conta
//     sobre a estrutura interna, e para ele não muda o que fazer.
import { requireOwner } from '../auth.server'
import { processIncomingMessage } from '../conversation.server'
import { contactIdDoPreview } from './preview'
import { type ResultadoDaFonte, resolverFonteDoPreview } from './preview.server'

/**
 * Os únicos códigos que aparecem em log. Allowlist, não texto livre: é o mesmo raciocínio
 * de `CODIGOS_DE_ERRO` na fila (§14) — o que vai para o log não pode depender do que veio de
 * fora, senão o log passa a ser um canal de saída para conteúdo da candidata.
 */
export const CODIGOS_DE_RECUSA = [
  'tenant_desconhecido',
  'versao_desconhecida',
  'ponteiro_incoerente',
  'nao_e_candidata',
  'geracao_divergente',
  'base_mudou',
  'artefatos_invalidos',
] as const

export type CodigoDeRecusa = (typeof CODIGOS_DE_RECUSA)[number]

export type ResultadoDaExecucao =
  | {
      tipo: 'ok'
      conversationId: string
      assistantMessageId: string
      reply: string
      needsHuman: boolean
      /** Versão e geração que ATENDERAM — não o que foi pedido. Fecha a dúvida "testei o quê?". */
      versionId: string
      generation: number
    }
  | {
      tipo: 'recusado'
      /** Para log e métrica. Valor fixo, nunca derivado da candidata. */
      codigo: CodigoDeRecusa
      /** O que a pessoa lê. Sem termo interno e sem nome de campo. */
      orientacao: string
    }

/**
 * Orientação por código. Duas regras ao escrever qualquer uma delas:
 *
 * - diz O QUE FAZER, não o que está errado por dentro;
 * - não distingue casos que levam à mesma ação. `ponteiro_incoerente` tem dois motivos
 *   internos (setup de outra empresa, versão que não é mais a pendente) e uma orientação só:
 *   contar a diferença descreveria a estrutura do banco para quem não pode agir sobre ela.
 */
export const ORIENTACAO: Record<CodigoDeRecusa, string> = {
  tenant_desconhecido: 'Não encontramos sua empresa. Entre novamente e tente de novo.',
  versao_desconhecida:
    'Não encontramos essa preparação. Volte para a tela de preparação e comece o teste de lá.',
  // NÃO diz "nossa equipe já foi avisada". O único efeito hoje é um `console.warn`: não é
  // notificação durável, não cria tarefa e não prova que alguém verá. Prometer isso é a
  // mesma classe do bug "já registrei seu chamado" — afirmar um efeito operacional que não
  // aconteceu. Se um dia houver notificação persistida, a frase volta junto com ela.
  ponteiro_incoerente:
    'Não conseguimos abrir essa preparação para teste. Volte para a tela de preparação. Se o problema continuar, entre em contato com o suporte.',
  nao_e_candidata:
    'Sua IA ainda não está liberada para teste. Nossa equipe está revisando — volte mais tarde para testar.',
  geracao_divergente:
    'Sua preparação foi atualizada depois que esta página abriu. Recarregue para testar a versão nova.',
  base_mudou:
    'A configuração publicada mudou depois desta preparação. É preciso enviar as respostas de novo para gerar sobre a versão atual.',
  artefatos_invalidos:
    'Houve um problema no material preparado para sua IA. Volte para a tela de preparação e tente novamente mais tarde. Se o problema continuar, entre em contato com o suporte.',
}

/** Traduz a recusa da resolução no código fixo correspondente. */
function codigoDaRecusa(recusa: Exclude<ResultadoDaFonte, { tipo: 'ok' }>): CodigoDeRecusa {
  return recusa.tipo
}

/**
 * Registra a recusa para quem opera. Só o código e — quando existe — o motivo interno, que
 * é um literal de conjunto fechado. Nada da candidata, nada do que a pessoa digitou.
 */
function registrar(recusa: Exclude<ResultadoDaFonte, { tipo: 'ok' }>, codigo: CodigoDeRecusa) {
  const motivo = recusa.tipo === 'ponteiro_incoerente' ? ` (${recusa.motivo})` : ''
  console.warn(`[setup-preview] recusado: ${codigo}${motivo}`)
}

/**
 * Executa uma mensagem de teste contra a candidata.
 *
 * `request` entra para UMA coisa: a sessão. Note o que não existe na assinatura — tenant.
 *
 * `setupVersionId` e `generation` vêm da tela, e por isso são conferidos contra o banco por
 * `resolverFonteDoPreview` antes de qualquer execução. Nenhum deles é confiado: o pior que um
 * valor inventado consegue é uma recusa.
 */
export async function executarPreviewDaCandidata(input: {
  request: Request
  setupVersionId: string
  generation: number
  message: string
}): Promise<ResultadoDaExecucao> {
  // Única fonte de tenant e de identidade. Lança redirect: /login sem sessão, /atendente
  // para quem não é dono.
  //
  // `requireOwner`, não `requireOperator`: a preparação da IA é owner-only em
  // `/preparar-ia`, e executar a candidata é a mesma alçada. Um atendente comum veria — e
  // avaliaria — a configuração que a empresa ainda não aprovou. O modo se chama
  // `owner_preview` exatamente por isso.
  const operator = await requireOwner(input.request)

  const fonte = await resolverFonteDoPreview({
    tenantSlug: operator.tenantSlug,
    setupVersionId: input.setupVersionId,
    generation: input.generation,
  })
  if (fonte.tipo !== 'ok') {
    const codigo = codigoDaRecusa(fonte)
    registrar(fonte, codigo)
    return { tipo: 'recusado', codigo, orientacao: ORIENTACAO[codigo] }
  }

  // O snapshot segue INTEIRO para o motor, e é a única fonte de config e base dali em diante.
  // `mode: 'owner_preview'` é o que desliga os efeitos — o motor deriva isso do modo, e o
  // tipo do modo é o que impede este snapshot de ser passado com `mode: 'whatsapp'`.
  const resultado = await processIncomingMessage({
    tenantSlug: operator.tenantSlug,
    message: input.message,
    contactId: contactIdDoPreview(
      operator.accountId,
      fonte.fonte.versionId,
      fonte.fonte.generation,
    ),
    mode: 'owner_preview',
    previewSnapshot: { config: fonte.fonte.config, conhecimento: fonte.fonte.conhecimento },
  })

  return {
    tipo: 'ok',
    conversationId: resultado.conversationId,
    assistantMessageId: resultado.assistantMessageId,
    reply: resultado.reply,
    needsHuman: resultado.needsHuman,
    versionId: fonte.fonte.versionId,
    generation: fonte.fonte.generation,
  }
}
