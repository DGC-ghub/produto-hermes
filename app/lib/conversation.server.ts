import { db } from '../db.server'
import { executarPedido, horariosParaOferecer } from './agenda/pedido'
import { agendaDoTenant, tratarRespostaConfirmacao } from './agenda/registro'
import { reportDegradation, reportSensitiveHandoff } from './alarm.server'
import { activeProviderName, generateAttendantReply } from './attendant'
import { buildCompanyRules } from './attendant/rules'
import { safeDefaultConfig, type TenantConfig } from './attendant/tenant-config'
import { resolveTenantConfig } from './attendant/tenant-config-db.server'
import { checkBillingGate } from './billing-gate.server'
import { isHumanHandling } from './conversation-status'
import { decideHandoff } from './handoff'
import type { KnowledgeDocument } from './knowledge.server'
import { resolveKnowledge } from './knowledge-db.server'
import { extractLeadPatch } from './lead'
import { createTimer, type Timer } from './metrics'
import { recordMessageTrace, type TraceOutcome } from './metrics.server'
import { retrieveRelevantChunks } from './retrieval'
import { comRetry } from './setup/retry'
import { resolveTenant } from './tenants.server'
import { hasDuplicateOpenTicket } from './ticket'

/**
 * Os três modos de execução do motor (spec §7.2). OBRIGATÓRIO: omitir é erro de tipo.
 *
 * Antes havia `channel?` e `preview?` independentes, e a combinação errada era possível de
 * escrever: `channel: 'whatsapp'` com `preview: true` alarmava o operador por uma execução
 * que não era de cliente nenhum. Com um campo só, canal e efeitos param de ser escolha de
 * quem chama e passam a ser CONSEQUÊNCIA do modo.
 */
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

/** Config e base resolvidas por quem chamou — a candidata em revisão (§7.4). */
export type SnapshotDoPreview = {
  config: TenantConfig
  conhecimento: KnowledgeDocument[]
}

type EntradaBase = {
  tenantSlug: string
  message: string
  /**
   * Identidade do contato. OBRIGATÓRIA.
   *
   * Era opcional, com um `?? 'demo-user'` no meio do motor, e a combinação disso com
   * `conversationId` abria um vazamento: sem contato informado, a conferência do dono da
   * conversa era PULADA, e qualquer conversa do mesmo tenant e canal era aceita — o motor
   * lia o histórico, o lead e os chamados de outra pessoa e gravava resposta na conversa
   * dela.
   *
   * Todos os chamadores já têm identidade própria (número do WhatsApp, visitante da demo,
   * conta no simulador, conta+versão+geração no preview), então o default anônimo não
   * servia a ninguém — só enfraquecia a fronteira.
   */
  contactId: string
  conversationId?: string
}

/**
 * União discriminada pelo modo. `previewSnapshot?: never` nos outros dois não é decoração:
 * é o que faz `mode: 'whatsapp'` com snapshot da candidata não COMPILAR. Uma config em
 * revisão atendendo cliente real é o pior desfecho possível desta fatia, e a barreira certa
 * para ele é o compilador, não uma checagem em runtime que alguém pode esquecer.
 */
export type ProcessIncomingMessageInput = EntradaBase &
  (
    | { mode: 'public_demo'; previewSnapshot?: never }
    | {
        mode: 'owner_preview'
        /**
         * Opcional: `owner_preview` roda sobre a candidata (com snapshot) OU sobre a
         * publicada (sem), que é o caso da tela `/testar-ia` de hoje.
         *
         * Config e conhecimento vêm JUNTOS, num campo só, porque o erro que anula o preview
         * é executar a config nova contra a base que já está no ar — o dono testaria uma
         * coisa e aprovaria outra. Não há campo para um sem o outro.
         *
         * Depois deste ponto o motor NÃO relê config nem base de nenhuma fonte.
         */
        previewSnapshot?: SnapshotDoPreview
      }
    | { mode: 'whatsapp'; previewSnapshot?: never }
  )

/**
 * Os modos existentes, em RUNTIME. O tipo é derivado desta lista de propósito: quem valida
 * precisa conferir contra a lista de verdade, e duas fontes divergiriam na primeira mudança.
 */
export const EXECUTION_MODES = ['public_demo', 'owner_preview', 'whatsapp'] as const

/** Conjunto para a checagem de pertencimento. Ver `perfilDoModo`. */
const MODOS_VALIDOS: ReadonlySet<string> = new Set(EXECUTION_MODES)

/** O que cada modo IMPLICA. Tabela da §7.2, num lugar só. */
const PERFIL_DO_MODO: Record<
  ExecutionMode,
  { channel: 'simulator' | 'whatsapp'; operationalEffects: boolean }
> = {
  public_demo: { channel: 'simulator', operationalEffects: false },
  owner_preview: { channel: 'simulator', operationalEffects: false },
  whatsapp: { channel: 'whatsapp', operationalEffects: true },
}

type PerfilDoModo = (typeof PERFIL_DO_MODO)[ExecutionMode]

/**
 * Lê o perfil do modo — e RECUSA em runtime o que o tipo já proíbe.
 *
 * O tipo é a primeira barreira e some na compilação. Um `as`, um chamador em JavaScript,
 * dado que veio de JSON ou uma borda futura mais frouxa ainda conseguem montar
 * `{ mode: 'whatsapp', previewSnapshot }` — e aí a candidata em revisão atenderia cliente
 * real, com tools operacionais, lead, chamado, handoff e alarme ligados. É o pior desfecho
 * desta fatia, e uma garantia só de compilação não é garantia suficiente para ele.
 *
 * Vale registrar por que esta função existe: a versão anterior do motor tinha a propriedade
 * runtime "snapshot presente ⇒ sem efeitos", derivada em código. Ao trocar por
 * `ExecutionMode`, o tipo passou a expressar a mesma regra de forma mais forte no papel — e
 * a garantia em runtime se perdeu no caminho. Agora são as duas.
 *
 * Mensagens FIXAS, sem nada do snapshot: elas vão para log (§14).
 */
function perfilDoModo(input: ProcessIncomingMessageInput): PerfilDoModo {
  // PERTENCIMENTO, não truthiness da indexação.
  //
  // `PERFIL_DO_MODO` é um objeto comum, então `PERFIL_DO_MODO['constructor']` devolve uma
  // FUNÇÃO — truthy. Um `!perfil` deixava passar `constructor`, `toString` e `valueOf`, e a
  // desestruturação seguinte dava `channel: undefined`. O elo final é o Prisma: filtro
  // `undefined` é OMITIDO, então a busca da conversa por identidade perdia o filtro de canal
  // e podia reusar a conversa real de WhatsApp de um cliente. Medido, não suposto.
  if (!MODOS_VALIDOS.has(input.mode)) {
    throw new Error('Invalid execution mode')
  }
  if (input.previewSnapshot !== undefined && input.mode !== 'owner_preview') {
    throw new Error('Preview snapshot requires owner preview mode')
  }
  // Identidade do contato: o tipo exige, e um `as` ou chamador em JavaScript não. Aqui, antes
  // de qualquer leitura de conversa, porque é ela que a identidade protege.
  if (typeof input.contactId !== 'string' || input.contactId.trim().length === 0) {
    throw new Error('Contact identity is required')
  }
  return PERFIL_DO_MODO[input.mode]
}

export type ProcessIncomingMessageSource = {
  fileName: string
  title: string
  score: number
}

export type ProcessIncomingMessageResult = {
  conversationId: string
  tenantSlug: string
  userMessageId: string
  assistantMessageId: string
  reply: string
  needsHuman: boolean
  handoffReason?: string
  confidence: number
  sources: ProcessIncomingMessageSource[]
  // true quando um humano assumiu a conversa e o Hermes ficou em silêncio.
  humanHandling?: boolean
}

const HISTORY_LIMIT = 12

// Resolve o TenantConfig com fallback em camadas (estratégia C do M2.5): BANCO primeiro,
// ARQUIVO como reserva, e se nada existir/estiver válido, um default conservador (sem ações,
// escala humano) — nunca comportamento solto.
async function loadConfigSafe(slug: string): Promise<TenantConfig> {
  try {
    const config = await resolveTenantConfig(slug)
    if (config) {
      return config
    }
    console.error(`[hermes] TenantConfig ausente para "${slug}" — usando default seguro`)
  } catch (error) {
    console.error(`[hermes] TenantConfig inválido para "${slug}" — usando default seguro`, error)
  }
  return safeDefaultConfig(slug)
}

/**
 * O PONTO DE LINEARIZAÇÃO com a tomada humana.
 *
 * O motor lê o status da conversa uma vez, antes do cérebro — e o cérebro é a chamada mais
 * lenta do fluxo (dezenas de segundos com provider real). No meio dela o operador pode clicar
 * "assumir". Uma simples releitura antes de gravar ENCURTA a janela, não a fecha: entre o
 * `SELECT` e o `INSERT` a tomada ainda cabe.
 *
 * Isto é um `updateMany` condicional, ou seja, uma ESCRITA — e é a escrita que estabelece
 * ordem com a action do operador. Um dos dois vence:
 *
 * - motor vence: a resposta pertence ao instante anterior à tomada, e o operador assume
 *   depois do commit;
 * - tomada vence: `count === 0`, nada é gravado, e o motor se cala.
 *
 * `count === 0` também cobre a conversa apagada no meio do caminho. Vale em TODOS os modos:
 * em preview não há efeito operacional, mas a mensagem seria gravada dentro da conversa que
 * o atendente está conduzindo.
 *
 * ── POR QUE ISTO É UMA FUNÇÃO PURA, E NÃO UM HELPER QUE ESCREVE ──────────────────────────
 *
 * Ela monta os argumentos; quem dá o `await tx.conversation.updateMany(...)` é o corpo da
 * própria transação. Um helper que recebesse `tx` e escrevesse aqui dentro esconderia a
 * fronteira da transação de quem lê o caminho quente — e, pior, do scanner que a guarda
 * (`fronteira-transacao.test.ts`): uma espera externa escondida no corpo do helper passaria
 * despercebida, que foi o mutante que sobreviveu à primeira versão daquele teste.
 *
 * O `where` fica num lugar só de propósito: os dois caminhos (guard e cérebro) precisam
 * concordar sobre quem tem autoridade para escrever. Duplicar a condição em dois pontos é
 * como ela diverge — um muda, o outro fica para trás, e o invariante passa a valer só em
 * metade do motor.
 */
function casDaTomada(conversationId: string) {
  return {
    // ALLOWLIST, não negação. `not: 'human'` respondia a "quem está proibido?", e a resposta
    // ficava incompleta: `closed` passava, e o motor gravava resposta dentro de um atendimento
    // que o operador tinha ENCERRADO — ressuscitando-o para `needs_human` por uma transição
    // que a máquina de estados nem prevê. Um status novo que alguém adicione amanhã também
    // passaria, sem ninguém decidir isso.
    //
    // A lista responde à pergunta certa: "em quais estados a IA ainda tem autoridade para
    // escrever?" — e a resposta são estes dois. Qualquer outro (human, closed, e o que vier
    // depois) perde o CAS e o motor se cala. Fail-closed: o desconhecido reprova por omissão,
    // em vez de ser autorizado por omissão.
    where: { id: conversationId, status: { in: ['open', 'needs_human'] } },
    data: { updatedAt: new Date() },
  }
}

/** O que a transação final decidiu. */
/**
 * Por que o CAS não passou. Perder o CAS significa "a conversa não é mais da IA" — mas os
 * motivos são fenômenos diferentes, e tratá-los como um só mente em duas direções: registra
 * "humano assumiu" quando ninguém assumiu nada (a conversa foi encerrada, ou apagada), e
 * esconde o caso caro (assumiu DEPOIS do cérebro, com a resposta pronta e jogada fora).
 */
type MotivoDaPerda = 'human' | 'closed' | 'missing' | 'unknown'

type Finalizacao =
  | { tipo: 'autoridade_perdida'; motivo: MotivoDaPerda }
  | { tipo: 'ok'; assistantMessageId: string }

/**
 * Traduz o estado encontrado depois de perder o CAS.
 *
 * PURA de propósito, e a leitura que a alimenta fica inline no corpo da transação: um helper
 * que recebesse `tx` e lesse aqui dentro é justamente o que `fronteira-transacao.test.ts`
 * proíbe — o corpo dele não é visível para o scanner, e uma espera escondida ali passaria.
 *
 * A leitura NÃO autoriza nada e não substitui o CAS: o CAS é a escrita condicional que
 * estabelece a ordem, e continua sendo ele quem decide. Isto existe só para o resultado e a
 * telemetria contarem a verdade.
 */
function classificarPerda(status: string | null | undefined): MotivoDaPerda {
  if (status == null) return 'missing'
  if (status === 'human') return 'human'
  if (status === 'closed') return 'closed'
  // Status que a allowlist não conhece. Fail-closed: silêncio, e o trace diz que foi um
  // estado que ninguém previu — em vez de fingir que um humano assumiu.
  return 'unknown'
}

/** O outcome de cada motivo, quando a perda acontece DURANTE o processamento. */
const OUTCOME_DA_PERDA: Record<MotivoDaPerda, TraceOutcome> = {
  human: 'human_took_over',
  closed: 'conversation_closed',
  missing: 'conversation_missing',
  unknown: 'authority_lost_unknown',
}

/**
 * O retorno quando a IA perde a autoridade sobre a conversa: a mensagem do cliente foi
 * gravada (o atendente precisa vê-la) e o Hermes não diz nada.
 *
 * O silêncio é o mesmo nos quatro motivos; o que muda é o que o resultado DIZ. Só o caso
 * `human` é atendimento humano em andamento — nos outros três não há ninguém conduzindo, e
 * marcar `humanHandling` ali colocaria na fila do operador uma conversa encerrada ou
 * inexistente.
 */
function silencioPorPerdaDeAutoridade(
  conversationId: string,
  tenantSlug: string,
  userMessageId: string,
  motivo: MotivoDaPerda,
): ProcessIncomingMessageResult {
  const humano = motivo === 'human'
  // Em `missing` a conversa sumiu, e as mensagens dela com ela: devolver o id de uma linha
  // apagada é pior que não devolver nada — quem recebe trata como handle persistido. O
  // `conversationId` continua, porque ele é a chave de correlação do processamento (o trace
  // grava por ele e não tem FK), não uma promessa de que a linha ainda exista.
  const idDaFala = motivo === 'missing' ? '' : userMessageId
  const razao: Record<MotivoDaPerda, string> = {
    human: 'human_handling',
    closed: 'conversation_closed',
    missing: 'conversation_missing',
    unknown: 'authority_lost',
  }
  return {
    conversationId,
    tenantSlug,
    userMessageId: idDaFala,
    assistantMessageId: '',
    reply: '',
    needsHuman: humano,
    handoffReason: razao[motivo],
    confidence: 0,
    sources: [],
    humanHandling: humano,
  }
}

/**
 * Limites da transação final. O cérebro fica FORA dela — dentro só há operações rápidas de
 * banco. Em contenção o Prisma lança, e quem chamou (a fila do WhatsApp) reprocessa o evento.
 */
/**
 * REPETIR A TRANSAÇÃO, NUNCA O FLUXO — com o classificador que o projeto já tem.
 *
 * Quando a persistência falha, `processIncomingMessage` lança, e na fila isso devolve o evento
 * para `pending`: o próximo dreno reexecuta o motor DO ZERO, duplicando a fala do cliente,
 * pagando o cérebro outra vez e reabrindo a janela de corrida com o operador — três estragos
 * para uma falha que costuma passar milissegundos depois.
 *
 * Uma versão anterior deste arquivo trazia classificador PRÓPRIO, e ele era mais permissivo que
 * `setup/retry.ts` justamente onde importa: aceitava `Transaction not found` — que também
 * descreve a transação que já COMEÇOU e morreu, e aí a tentativa anterior pode ter escrito —,
 * `timed out` sem exigir o código do Prisma (redação que aparece em erro de socket, de fetch,
 * de qualquer biblioteca) e `deadlock` genérico. Repetir sobre erro ambíguo é exatamente como
 * se duplica efeito, e o comentário prometia uma garantia ("se falhou, nada foi commitado") que
 * só vale para erro de AQUISIÇÃO.
 *
 * Aquele também não tinha teto de relógio: 3 tentativas de 15 s mais backoff passava de 45 s.
 * `comRetry` tem orçamento monotônico de 30 s e deriva `maxWait`/`timeout` dele — por isso as
 * transações daqui recebem `opcoes` em vez de constante fixa.
 *
 * Dois classificadores concorrentes para a mesma pergunta é como um deles fica para trás.
 *
 * Isto NÃO resolve o evento reprocessado depois de restart, órfão ou `markDone` esgotado: essa
 * é a idempotência durável do `WebhookEvent`, que precisa de estágio persistido, não de retry.
 */

/**
 * Contexto que a casca de medição precisa e que só é conhecido no meio do
 * caminho (o tenant é resolvido lá dentro). Preenchido pelo corpo à medida que
 * descobre; lido pela casca ao fechar o trace, inclusive quando dá exceção.
 */
type TraceContext = {
  tenantId?: string
  conversationId?: string
  outcome: TraceOutcome
  /**
   * O provider e se o cérebro chegou a ser CHAMADO — fatos, não inferência.
   *
   * O `finally` derivava o provider do outcome (`ok` ou `fallback` → provider real, senão
   * `nenhum`), e isso apagava o consumo justamente no caso que interessa medir: o cérebro
   * rodou, custou os segundos e o dinheiro, e o CAS perdeu depois. No trace aparecia
   * `provider: 'nenhum'`, como se nada tivesse sido gasto.
   *
   * `brainStarted` marca ANTES da chamada, de propósito: o custo potencial existe a partir do
   * momento em que o provider é acionado, mesmo que ele lance no meio.
   */
  provider: string
  brainStarted: boolean
}

/**
 * Orquestra o "balcão" do Hermes para uma mensagem recebida. O comportamento é
 * código único; o que muda por empresa vem do TenantConfig (regras, base, tools,
 * guard-rails, escalação) — aplicado determinísticamente aqui, nunca confiado ao
 * prompt. O "cérebro" (atendente IA) é plugável (ver `app/lib/attendant`).
 *
 * Server-side — usa o banco. Não importar em componente React.
 */
export async function processIncomingMessage(
  input: ProcessIncomingMessageInput,
): Promise<ProcessIncomingMessageResult> {
  // ANTES de tudo, inclusive do trace: um modo inválido não deve produzir medição, e indexar
  // a tabela no `finally` com modo inexistente esconderia o erro real por trás de outro.
  const perfil = perfilDoModo(input)
  const timer = createTimer()
  const ctx: TraceContext = { outcome: 'erro', provider: 'nenhum', brainStarted: false }
  try {
    return await runIncomingMessage(input, perfil, timer, ctx)
  } finally {
    // Sem await: a medição não entra no caminho crítico da resposta ao cliente.
    // Sem tenant resolvido não há o que gravar (a FK exige tenant existente).
    if (ctx.tenantId) {
      void recordMessageTrace({
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        // Do perfil JÁ VALIDADO, igual ao corpo: a métrica por canal não pode discordar do
        // que executou, e não relê a tabela por conta própria.
        channel: perfil.channel,
        // Do que REALMENTE aconteceu, não do desfecho: uma tomada humana depois do cérebro
        // precisa continuar mostrando o provider que foi consumido.
        provider: ctx.brainStarted ? ctx.provider : 'nenhum',
        outcome: ctx.outcome,
        trace: timer.finish(),
      })
    }
  }
}

async function runIncomingMessage(
  input: ProcessIncomingMessageInput,
  perfil: PerfilDoModo,
  timer: Timer,
  ctx: TraceContext,
): Promise<ProcessIncomingMessageResult> {
  const message = input.message.trim()
  if (message.length === 0) {
    throw new Error('Message is required')
  }
  // Canal e efeitos vêm do MODO, já validado por `perfilDoModo`. É a única leitura destes
  // dois valores em todo o motor: qualquer decisão abaixo pergunta a `operationalEffects`, e
  // nunca ao canal.
  const { channel, operationalEffects } = perfil

  // Tenant vem do BANCO (fonte de verdade) — um cliente novo funciona só existindo
  // no banco, sem redeploy. Seeds conhecidos são criados on-demand; slug de fora
  // é rejeitado (não cria sujeira no banco).
  const tenant = await timer.step('tenant', () => resolveTenant(input.tenantSlug))
  if (!tenant) {
    throw new Error(`Unknown tenant: ${input.tenantSlug}`)
  }
  ctx.tenantId = tenant.id

  // O SNAPSHOT TEM QUE SER DESTA EMPRESA.
  //
  // "Config e base juntas" impede misturar a config candidata com a base publicada, mas não
  // diz nada sobre de QUEM é o par. Sem esta guarda, um chamador server-side podia executar
  // a persona e a base da empresa B numa conversa criada sob a empresa A — e a resposta,
  // formada com o material de B, ficaria gravada na conversa de A.
  //
  // Antes de resolver a conversa, de propósito: depois já existiria linha no banco.
  //
  // Erro FIXO, sem slug e sem conteúdo: a mensagem vai para o log, e nem o nome da outra
  // empresa nem trecho de base dela têm por que aparecer lá (§14). Lança em vez de degradar
  // porque não é entrada de cliente — é chamador interno errado, e silenciar esconderia o bug.
  if (input.previewSnapshot) {
    const configDesteTenant = input.previewSnapshot.config.slug === tenant.slug
    // Vazio passa: a base vazia é barrada antes, por quem resolve o snapshot, e não carrega
    // dado de outra empresa. O que esta linha guarda é a PROCEDÊNCIA de cada documento.
    const baseDesteTenant = input.previewSnapshot.conhecimento.every(
      (doc) => doc.tenantSlug === tenant.slug,
    )
    if (!configDesteTenant || !baseDesteTenant) {
      throw new Error('Preview snapshot tenant mismatch')
    }
  }

  // Com snapshot, a config JÁ vem resolvida e validada (a resolução é de quem chamou):
  // reler aqui traria a publicada e desfaria o preview.
  const config =
    input.previewSnapshot?.config ??
    (await timer.step('config', () => loadConfigSafe(input.tenantSlug)))

  // A CONFIG EFETIVA: em modo não operacional, sem ferramenta nenhuma.
  //
  // Isto é o que torna "sem efeitos operacionais" verdadeiro no PROMPT, e não só na
  // persistência. Antes, um preview recebia as tools do tenant, o prompt ensinava a propor
  // `abrir_chamado`, o cérebro propunha, o validador aceitava — e a camada de efeitos
  // descartava em silêncio. Resultado: a IA dizia "já registrei" num teste onde nada é
  // registrado, e a única barreira era a guarda anti-mentira lá no fim.
  //
  // Zerando aqui, o prompt nem oferece a ação, `enabledTools` fica vazio e o validador
  // descarta qualquer action — as três camadas passam a concordar. `whatsapp` mantém as
  // tools reais, e é o único modo que as tem.
  //
  // Tudo abaixo usa `configEfetiva`. Usar `config` para regras, tools ou policy reabriria o
  // buraco; os campos que não mudam (slug, sourceDir, escalationPolicy) são os mesmos nos dois.
  const configEfetiva: TenantConfig = operationalEffects ? config : { ...config, tools: [] }

  // Conversa: reutiliza a informada (validando dono) ou resolve pela IDENTIDADE
  // do contato. No WhatsApp a identidade é o número (contactId) e a mensagem chega
  // SEM conversationId — então, se este contato já tem uma conversa ativa, seguimos
  // nela (preservando histórico e lead). Só abrimos conversa nova para um contato
  // novo ou quando a anterior foi encerrada. É isto que faz o Hermes LEMBRAR de
  // quem volta, em vez de tratar cada retorno como um estranho.
  const resolved = await timer.step('conversation', async () => {
    if (input.conversationId) {
      const existing = await db.conversation.findUnique({
        where: { id: input.conversationId },
      })
      // A conversa informada tem que ser DESTE tenant, DESTE canal e DESTE contato.
      //
      // Só o tenant não basta: com `owner_preview` e o id de uma conversa real de WhatsApp da
      // mesma empresa, o motor lia o histórico daquele cliente, o lead e os chamados dele,
      // mandava tudo isso para o cérebro e gravava as mensagens de teste DENTRO do
      // atendimento real. Sem enviar nada para fora — e ainda assim misturando teste com
      // atendimento e mostrando dados de um cliente a quem só queria testar.
      //
      // O canal vem do MODO, então é o modo que decide qual conversa pode ser reutilizada.
      // O contato só é exigido quando quem chama informou um: no WhatsApp ele sempre vem.
      //
      // Mensagem inalterada e indistinguível: quem cola um id não descobre se ele existe.
      // A comparação de contato é INCONDICIONAL. Hoje ela é redundante — `perfilDoModo` já
      // recusou contato ausente ou vazio antes daqui —, e por isso nenhuma mutação dela
      // derruba teste: escrevê-la como `contactId !== undefined && ...` produz código
      // equivalente. Fica na forma incondicional porque é a que expressa a regra sem depender
      // de uma validação que mora em outra função e pode se mover.
      //
      // O status entra na mesma conferência: `closed` é o encerramento decidido pelo
      // atendente, e informar o id explicitamente era a ÚNICA porta para escrever ali dentro
      // — a resolução por identidade já ignora as encerradas, e o CAS protege só a gravação
      // final, depois de o motor ter lido o histórico e gravado a fala do cliente. Mensagem
      // depois do encerramento vira conversa NOVA; a antiga fica como está.
      if (
        !existing ||
        existing.tenantId !== tenant.id ||
        existing.channel !== channel ||
        existing.contactId !== input.contactId ||
        existing.status === 'closed'
      ) {
        throw new Error('Conversation not found')
      }
      return { id: existing.id, contactId: existing.contactId, status: existing.status }
    }
    const contact = input.contactId
    // `channel` no filtro: a conversa reutilizada tem que ser do mesmo modo. Sem isto, um
    // teste do dono continuaria a conversa de WhatsApp do próprio número dele, e a resposta
    // de teste entraria no atendimento real.
    const active = await db.conversation.findFirst({
      where: { tenantId: tenant.id, contactId: contact, channel, status: { not: 'closed' } },
      orderBy: { updatedAt: 'desc' },
    })
    if (active) {
      return { id: active.id, contactId: active.contactId, status: active.status }
    }
    const created = await db.conversation.create({
      data: {
        tenantId: tenant.id,
        channel,
        contactId: contact,
        status: 'open',
      },
    })
    return { id: created.id, contactId: created.contactId, status: created.status }
  })
  const conversationId = resolved.id
  const contactId = resolved.contactId
  const conversationStatus = resolved.status
  ctx.conversationId = conversationId

  // Se um humano ASSUMIU esta conversa, o Hermes se cala: registra a mensagem do
  // cliente (para o atendente ver) e devolve sem gerar resposta da IA.
  //
  // SEM `operationalEffects` aqui, de propósito. `operationalEffects` responde "esta execução
  // deve GRAVAR registro operacional?" — e "um humano assumiu" não é um efeito a ser
  // condicionado, é um ESTADO a ser obedecido. Usar a flag aqui inverteu o sentido dela:
  // gateava uma restrição em vez de uma escrita, e o resultado era a IA gravando
  // `role: 'assistant'` dentro de uma conversa que um atendente estava conduzindo —
  // indistinguível da fala dele na ficha de `/atendente`.
  //
  // Alcançável sem cast: a fila do atendente não filtra canal, então uma conversa de demo ou
  // de simulador pode ser assumida, e a busca por identidade a reutiliza na visita seguinte.
  // O corpo abaixo é seguro em modo não operacional: grava a mensagem do cliente e toca
  // `updatedAt`, que é o que o preview já faz de qualquer forma.
  if (isHumanHandling(conversationStatus)) {
    ctx.outcome = 'human_at_entry'
    const userMessage = await timer.step('persist_user', async () => {
      const created = await db.message.create({
        data: { conversationId, role: 'user', content: message },
      })
      await db.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      })
      return created
    })
    // `human` por definição: este ramo só é alcançado com a conversa já sob condução humana.
    return silencioPorPerdaDeAutoridade(conversationId, input.tenantSlug, userMessage.id, 'human')
  }

  // Gate de cobrança: se a assinatura existe mas não está ativa (E o flag está ligado), o
  // Hermes não gasta o cérebro caro — registra a mensagem e escala pra humano (o dono resolve:
  // paga ou responde manual). Grandfathering + flag desligado por padrão garantem que pilotos/
  // legado nunca são bloqueados. Ver app/lib/billing-gate.server.ts.
  const gate = await timer.step('billing', () => checkBillingGate(tenant.id))
  if (!gate.allowed) {
    ctx.outcome = 'billing_blocked'
    // NUMA TRANSAÇÃO SÓ, pela mesma razão dos outros dois caminhos.
    //
    // Eram duas escritas soltas: `message.create` e, depois, o status. Duas coisas davam
    // errado. A primeira, um `update` cego atropelava a decisão de quem estava conduzindo —
    // o operador que assumisse durante a consulta ao gate via a conversa voltar para
    // `needs_human` e sumir da tela dele no meio do atendimento. A segunda, mais silenciosa:
    // se a fala do cliente commitasse e o status falhasse, o motor lançava, a fila devolvia o
    // evento para `pending` e o reprocessamento gravava a fala do cliente OUTRA VEZ.
    //
    // Com o CAS como primeiro comando e a mensagem dentro da mesma transação, ou as duas
    // coisas acontecem ou nenhuma acontece.
    const userMessage = await timer.step('persist_user', () =>
      comRetry((opcoes) =>
        db.$transaction(async (tx) => {
          // O CAS continua sendo o PRIMEIRO comando — é ele que estabelece a ordem.
          const autorizada = await tx.conversation.updateMany(casDaTomada(conversationId))

          // Perdemos o CAS: alguém tem a conversa. O motivo é descoberto ANTES de tentar
          // gravar, e a ordem não é detalhe: se a conversa foi APAGADA, criar a fala do
          // cliente bate na chave estrangeira e lança — o motor morria com erro de FK, a fila
          // devolvia o evento para `pending`, e `conversation_missing` nunca era registrado.
          //
          // A leitura é pelo mesmo `tx` e não autoriza nada: quem decide continua sendo o CAS.
          if (autorizada.count === 0) {
            const atual = await tx.conversation.findUnique({
              where: { id: conversationId },
              select: { status: true },
            })
            const motivo = classificarPerda(atual?.status)

            // Sem conversa não há onde gravar. Nada a persistir, e nada a apontar depois.
            if (motivo === 'missing') {
              return { mensagem: null, motivo }
            }

            const created = await tx.message.create({
              data: { conversationId, role: 'user', content: message },
            })

            // Humano CONDUZINDO: a fala nova precisa reordenar a fila dele — ela acabou de
            // chegar. Em `closed` não se toca em nada, e em `unknown` também não: fail-closed.
            if (motivo === 'human') {
              await tx.conversation.updateMany({
                where: { id: conversationId, status: 'human' },
                data: { updatedAt: new Date() },
              })
            }
            return { mensagem: created, motivo }
          }

          const created = await tx.message.create({
            data: { conversationId, role: 'user', content: message },
          })

          if (operationalEffects) {
            await tx.conversation.update({
              where: { id: conversationId },
              data: { status: 'needs_human' },
            })
          }

          return { mensagem: created, motivo: null }
        }, opcoes),
      ),
    )
    // A autoridade da conversa manda mais que o gate: se ela mudou de dono durante a
    // consulta, o desfecho é o silêncio daquele motivo — e não "bloqueado por cobrança".
    if (userMessage.motivo) {
      ctx.outcome = OUTCOME_DA_PERDA[userMessage.motivo]
      return silencioPorPerdaDeAutoridade(
        conversationId,
        input.tenantSlug,
        userMessage.mensagem?.id ?? '',
        userMessage.motivo,
      )
    }
    return {
      conversationId,
      tenantSlug: input.tenantSlug,
      userMessageId: userMessage.mensagem?.id ?? '',
      assistantMessageId: '',
      reply: '',
      needsHuman: true,
      handoffReason: 'billing_inactive',
      confidence: 0,
      sources: [],
    }
  }

  // Histórico ANTES de salvar a mensagem nova: a "memória" daquele contato.
  const priorMessages = await timer.step('history', () =>
    db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { role: true, content: true },
    }),
  )
  const history = priorMessages
    .reverse()
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        m.role === 'user' || m.role === 'assistant',
    )
    .map((m) => ({ role: m.role, content: m.content }))

  const userMessage = await timer.step('persist_user', async () => {
    const created = await db.message.create({
      data: { conversationId, role: 'user', content: message },
    })

    // Lead determinístico (barato e confiável); o atendente pode enriquecer depois.
    const detPatch = extractLeadPatch(message)
    if (operationalEffects && Object.keys(detPatch).length > 0) {
      await db.lead.upsert({
        where: { conversationId },
        create: { tenantId: tenant.id, conversationId, ...detPatch, stage: 'novo' },
        update: { ...detPatch },
      })
    }
    return created
  })

  // Guard-rail determinístico ANTES do cérebro — e com CURTO-CIRCUITO: pedido
  // explícito de humano e tema sensível já decidem a resposta segura, então não
  // pagamos a latência/custo do LLM nem executamos efeitos (lead/chamado) de uma
  // proposta cuja resposta o cliente nunca veria.
  // A base do snapshot, quando há: `config.knowledge.sourceDir` aponta para a pasta da
  // empresa e trazer de lá a base PUBLICADA é exatamente o erro que o campo único evita.
  const docs =
    input.previewSnapshot?.conhecimento ??
    (await timer.step('knowledge', () =>
      resolveKnowledge(configEfetiva.slug, configEfetiva.knowledge.sourceDir),
    ))
  const retrieved = timer.stepSync('retrieval', () => retrieveRelevantChunks(message, docs))
  const guard = timer.stepSync('guard', () =>
    decideHandoff({
      message,
      retrievedCount: retrieved.length,
      extraSensitiveTriggers: configEfetiva.escalationPolicy.triggers,
    }),
  )
  const guardForcesSafe = guard.reason === 'requested_human' || guard.reason === 'sensitive_topic'

  // Agenda: só com efeitos operacionais (WhatsApp). Preview e demo pública não mexem em agenda.
  const agenda = operationalEffects ? agendaDoTenant(tenant.slug) : null

  // Resposta 1/2/3 a uma confirmação pendente: decidida no balcão, sem gastar o cérebro. O que
  // não for 1/2/3 vai para a recepção. O guard vem antes: dor/remédio escala mesmo na confirmação.
  const confirmacao =
    agenda && !guardForcesSafe
      ? await timer.step('confirmacao', () =>
          tratarRespostaConfirmacao(tenant.slug, contactId, message),
        )
      : null
  const humanMessage = configEfetiva.escalationPolicy.humanMessage
  const atalho: { reply: string; needsHuman: boolean; reason: string } | null = guardForcesSafe
    ? { reply: humanMessage, needsHuman: true, reason: guard.reason ?? 'unknown' }
    : confirmacao?.kind === 'humano'
      ? { reply: humanMessage, needsHuman: true, reason: 'confirmacao_fora_do_padrao' }
      : confirmacao?.kind === 'resposta'
        ? { reply: confirmacao.reply, needsHuman: false, reason: 'confirmacao' }
        : null
  if (atalho) {
    const reply = atalho.reply
    // Mesma autorização do caminho longo. A janela aqui é de milissegundos (o guard não chama
    // o cérebro), mas o invariante é o mesmo — nenhuma mensagem de assistente entra numa
    // conversa que um humano conduz — e um invariante protegido em um caminho só vira bug no
    // outro na primeira vez que alguém mexer.
    const finalizacao = await timer.step('persist_reply', () =>
      comRetry((opcoes) =>
        db.$transaction(async (tx): Promise<Finalizacao> => {
          // O CAS da tomada, inline: é ele que estabelece a ordem com a action do operador.
          const autorizada = await tx.conversation.updateMany(casDaTomada(conversationId))
          if (autorizada.count !== 1) {
            const atual = await tx.conversation.findUnique({
              where: { id: conversationId },
              select: { status: true },
            })
            return { tipo: 'autoridade_perdida', motivo: classificarPerda(atual?.status) }
          }
          const created = await tx.message.create({
            data: {
              conversationId,
              role: 'assistant',
              content: reply,
              confidence: 0,
              sourcesJson: JSON.stringify([]),
            },
          })
          if (operationalEffects && atalho.needsHuman) {
            await tx.conversation.update({
              where: { id: conversationId },
              data: { status: 'needs_human' },
            })
            await tx.handoffEvent.create({
              data: { conversationId, reason: atalho.reason, message },
            })
          }
          return { tipo: 'ok', assistantMessageId: created.id }
        }, opcoes),
      ),
    )
    if (finalizacao.tipo === 'autoridade_perdida') {
      ctx.outcome = OUTCOME_DA_PERDA[finalizacao.motivo]
      return silencioPorPerdaDeAutoridade(
        conversationId,
        input.tenantSlug,
        userMessage.id,
        finalizacao.motivo,
      )
    }
    // Tema sensível não escala em silêncio: num tenant de saúde isso pode ser uma emergência
    // esperando na fila. Push no celular do operador (best-effort) — SÓ do canal real: a demo
    // pública é anônima e viraria botão de spam urgente.
    //
    // DEPOIS da transação, pela mesma razão do alarme de degradação: se a tomada humana venceu
    // a corrida, o operador já está na conversa e o push avisaria de uma escalação que não
    // aconteceu. Estava antes, e era a mesma assimetria que a revisão apontou no outro alarme.
    if (guard.reason === 'sensitive_topic' && operationalEffects) {
      void reportSensitiveHandoff(input.tenantSlug)
    }
    ctx.outcome = atalho.needsHuman ? 'guard_handoff' : 'ok'
    return {
      conversationId,
      tenantSlug: input.tenantSlug,
      userMessageId: userMessage.id,
      assistantMessageId: finalizacao.assistantMessageId,
      reply,
      needsHuman: atalho.needsHuman,
      handoffReason: atalho.needsHuman ? atalho.reason : undefined,
      confidence: 0,
      sources: [],
    }
  }

  const { currentLead, myTickets } = await timer.step('context', async () => {
    // Preview simula um contato novo sem ler nem misturar dados operacionais do tenant.
    if (!operationalEffects) {
      return { currentLead: null, myTickets: [] }
    }
    const lead = await db.lead.findUnique({ where: { conversationId } })

    // Chamados SÓ deste contato (isolamento determinístico — o LLM nunca vê os de outros).
    const ticketRows = await db.ticket.findMany({
      where: { tenantId: tenant.id, contactId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { subject: true, status: true },
    })
    return {
      currentLead: lead,
      myTickets: ticketRows.map((row) => ({ subject: row.subject, status: row.status })),
    }
  })

  // Contexto, regras e tools derivados do TenantConfig.
  const companyRules = buildCompanyRules(configEfetiva)
  const enabledTools = configEfetiva.tools
    .filter((tool) => tool.enabled)
    .map((tool) => ({ name: tool.name, limits: tool.limits }))

  // O cérebro: atendente IA plugável. A saída já vem validada (com a policy do
  // tenant) e com fallback seguro se o provider falhar.
  // ANTES da chamada: o custo potencial existe a partir do momento em que o provider é
  // acionado, mesmo que ele lance no meio. É isto que faz o trace de uma tomada humana
  // pós-cérebro continuar dizendo qual provider foi consumido.
  ctx.provider = activeProviderName()
  ctx.brainStarted = true
  const horariosLivres =
    agenda && enabledTools.some((tool) => tool.name === 'pedir_agendamento')
      ? await timer.step('agenda_slots', () =>
          horariosParaOferecer(agenda, new Date().toISOString()),
        )
      : null
  const decision = await timer.step('brain', () =>
    generateAttendantReply(
      {
        tenant: { slug: tenant.slug, name: configEfetiva.businessProfile.name },
        companyRules,
        enabledTools: enabledTools.map((tool) => tool.name),
        knowledge: retrieved.map((chunk) => ({ title: chunk.title, snippet: chunk.snippet })),
        history,
        lead: currentLead
          ? {
              name: currentLead.name,
              phone: currentLead.phone,
              neighborhood: currentLead.neighborhood,
              need: currentLead.need,
              urgency: currentLead.urgency,
            }
          : null,
        myTickets,
        agenda: horariosLivres ? { freeSlots: horariosLivres } : undefined,
        message,
      },
      {
        policy: {
          extraForbiddenClaims: configEfetiva.guardrails.neverPromise,
          outOfScope: configEfetiva.guardrails.outOfScope,
          tools: enabledTools,
        },
      },
    ),
  )

  // Alarme: se o cérebro CAIU no fallback (provider/validação), o cliente recebeu a
  // resposta genérica. Avisa o operador (best-effort) — não é escalação normal.
  const razaoDegradacao =
    decision.handoffReason === 'provider_error' || decision.handoffReason === 'validacao_falhou'
      ? decision.handoffReason
      : null
  // O alarme e o `outcome` são decididos DEPOIS da transação: alarmar aqui avisaria o
  // operador de uma "resposta genérica entregue ao cliente" que a tomada humana suprimiu.

  // Daqui pra baixo o guard não interfere (o curto-circuito acima já tratou os
  // casos forçados): a decisão de escalar é do cérebro validado.
  const needsHuman = decision.needsHuman
  const handoffReason = needsHuman ? (decision.handoffReason ?? 'unknown') : undefined
  // Pedido de agenda: o balcão confere e marca; o texto ao paciente sai do RESULTADO real
  // (a IA não consegue dizer "marquei" se a agenda recusou). Antes da transação: a agenda é
  // externa ao banco. Se o operador assumir nesse meio-tempo, a resposta é descartada, mas a
  // consulta marcada continua valendo (o paciente confirmou o horário).
  const pedidoAgenda = decision.action?.type === 'pedir_agendamento' ? decision.action : null
  const resultadoAgenda =
    pedidoAgenda && agenda && operationalEffects
      ? await timer.step('agenda', () => executarPedido(agenda, contactId, pedidoAgenda))
      : null
  const reply = resultadoAgenda?.reply ?? decision.reply
  const confidence = decision.confidence
  const sources: ProcessIncomingMessageSource[] = retrieved.map((chunk) => ({
    fileName: chunk.fileName,
    title: chunk.title,
    score: chunk.score,
  }))

  // ── TUDO O QUE A DECISÃO CAUSA, NUMA TRANSAÇÃO ────────────────────────────────
  //
  // O primeiro comando é o CAS de `casDaTomada`. Perder significa que o operador assumiu
  // durante o cérebro: nada é gravado, nem chamado, nem lead, nem resposta.
  //
  // Chamado e mensagem do assistente na MESMA transação, de propósito: se o chamado falhar, a
  // transação aborta e a resposta que afirma "registrei" não existe. A ordem antiga (chamado
  // fora, resposta depois) deixava a frase sobreviver ao chamado que não nasceu.
  const finalizacao = await timer.step('persist_reply', () =>
    comRetry((opcoes) =>
      db.$transaction(async (tx): Promise<Finalizacao> => {
        // O CAS da tomada, inline: é ele que estabelece a ordem com a action do operador.
        const autorizada = await tx.conversation.updateMany(casDaTomada(conversationId))
        if (autorizada.count !== 1) {
          const atual = await tx.conversation.findUnique({
            where: { id: conversationId },
            select: { status: true },
          })
          return { tipo: 'autoridade_perdida', motivo: classificarPerda(atual?.status) }
        }

        // SEM `timer.step('effects')` aqui.
        //
        // `effects` ficava ANINHADO dentro de `persist_reply`, e o timer soma por nome: o mesmo
        // intervalo entrava duas vezes no trace. Isso mente exatamente na pergunta que o trace
        // existe para responder ("onde foram os 20 segundos?") e deixa a asserção
        // "soma das etapas <= total" válida só por sorte — ela passava porque nesta suíte os
        // efeitos eram quase sempre vazios e arredondavam para zero.
        //
        // Os dois passaram a ser UMA operação atômica; medir as partes de uma transação como
        // etapas independentes é ficção. Fica tudo em `persist_reply`.
        if (operationalEffects) {
          // Enriquecimento de lead sugerido pelo atendente (precedência sobre o determinístico).
          if (decision.leadPatch && Object.keys(decision.leadPatch).length > 0) {
            await tx.lead.upsert({
              where: { conversationId },
              create: { tenantId: tenant.id, conversationId, ...decision.leadPatch, stage: 'novo' },
              update: { ...decision.leadPatch },
            })
          }

          // Ação proposta pelo atendente: o balcão executa (a IA não toca o banco). O
          // validador já garantiu que a ação é de uma tool habilitada para este tenant.
          // Dedup: não reabre um chamado que já cobre o mesmo problema — evita duplicar
          // quando o cliente reforça o pedido em mensagens seguidas (problemas distintos
          // continuam gerando chamados distintos).
          if (decision.action?.type === 'abrir_chamado') {
            // Busca TODOS os chamados abertos do contato — não a janela de 10 usada no
            // contexto do LLM —, senão um chamado antigo ainda em aberto escaparia do dedup.
            const openTickets = await tx.ticket.findMany({
              where: { tenantId: tenant.id, contactId, status: { in: ['aberto', 'em_andamento'] } },
              select: { subject: true },
            })
            const openSubjects = openTickets.map((row) => row.subject)
            if (!hasDuplicateOpenTicket(decision.action.subject, openSubjects)) {
              await tx.ticket.create({
                data: {
                  tenantId: tenant.id,
                  contactId,
                  subject: decision.action.subject,
                  description: decision.action.description,
                  category: decision.action.category ?? null,
                },
              })
            }
          }
        }

        const created = await tx.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content: reply,
            confidence,
            sourcesJson: JSON.stringify(sources),
          },
        })

        // O `updatedAt` já foi tocado pelo CAS de `casDaTomada` — sem ele, a resolução de
        // identidade, a ordem da fila do atendente e a "conversa ativa" do dossiê leriam um
        // timestamp congelado. Aqui só o STATUS, quando escala.
        if (needsHuman && operationalEffects) {
          await tx.conversation.update({
            where: { id: conversationId },
            data: { status: 'needs_human' },
          })
          await tx.handoffEvent.create({
            data: { conversationId, reason: handoffReason ?? 'unknown', message },
          })
        }
        return { tipo: 'ok', assistantMessageId: created.id }
      }, opcoes),
    ),
  )

  if (finalizacao.tipo === 'autoridade_perdida') {
    ctx.outcome = OUTCOME_DA_PERDA[finalizacao.motivo]
    return silencioPorPerdaDeAutoridade(
      conversationId,
      input.tenantSlug,
      userMessage.id,
      finalizacao.motivo,
    )
  }

  // Alarme só agora: se o cérebro CAIU no fallback, o cliente recebeu a resposta genérica —
  // e isso só é verdade porque a transação venceu e a resposta foi gravada.
  if (razaoDegradacao && operationalEffects) {
    void reportDegradation(razaoDegradacao)
  }
  // Separar 'fallback' de 'ok' na medição é o que permite ler o p95 do motor SADIO:
  // uma queda do provider responde em 200ms e mascararia a lentidão real na média.
  ctx.outcome = razaoDegradacao ? 'fallback' : 'ok'

  return {
    conversationId,
    tenantSlug: input.tenantSlug,
    userMessageId: userMessage.id,
    assistantMessageId: finalizacao.assistantMessageId,
    reply,
    needsHuman,
    handoffReason,
    confidence,
    sources,
  }
}
