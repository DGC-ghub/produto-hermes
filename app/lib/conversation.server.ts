import { db } from '../db.server'
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
 */
async function autorizarEscrita(
  tx: Pick<typeof db, 'conversation'>,
  conversationId: string,
): Promise<boolean> {
  const autorizada = await tx.conversation.updateMany({
    where: { id: conversationId, status: { not: 'human' } },
    data: { updatedAt: new Date() },
  })
  return autorizada.count === 1
}

/** O que a transação final decidiu. */
type Finalizacao = { tipo: 'humano_assumiu' } | { tipo: 'ok'; assistantMessageId: string }

/**
 * O retorno quando um humano conduz a conversa: a mensagem do cliente foi gravada (o
 * atendente precisa vê-la) e o Hermes não diz nada.
 *
 * Um só lugar porque há três caminhos que chegam aqui — o status já estava `human` na
 * entrada, ou a tomada venceu a corrida no caminho do guard, ou venceu no caminho do
 * cérebro. Três formatos diferentes de "silêncio" seriam três comportamentos de tela.
 */
function silencioDoHumano(
  conversationId: string,
  tenantSlug: string,
  userMessageId: string,
): ProcessIncomingMessageResult {
  return {
    conversationId,
    tenantSlug,
    userMessageId,
    assistantMessageId: '',
    reply: '',
    needsHuman: true,
    handoffReason: 'human_handling',
    confidence: 0,
    sources: [],
    humanHandling: true,
  }
}

/**
 * Limites da transação final. O cérebro fica FORA dela — dentro só há operações rápidas de
 * banco. Em contenção o Prisma lança, e quem chamou (a fila do WhatsApp) reprocessa o evento.
 */
const TRANSACAO_FINAL = { maxWait: 5_000, timeout: 15_000 } as const

/**
 * Contexto que a casca de medição precisa e que só é conhecido no meio do
 * caminho (o tenant é resolvido lá dentro). Preenchido pelo corpo à medida que
 * descobre; lido pela casca ao fechar o trace, inclusive quando dá exceção.
 */
type TraceContext = { tenantId?: string; conversationId?: string; outcome: TraceOutcome }

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
  const ctx: TraceContext = { outcome: 'erro' }
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
        provider:
          ctx.outcome === 'ok' || ctx.outcome === 'fallback' ? activeProviderName() : 'nenhum',
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
      if (
        !existing ||
        existing.tenantId !== tenant.id ||
        existing.channel !== channel ||
        existing.contactId !== input.contactId
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
    ctx.outcome = 'human_handling'
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
    return silencioDoHumano(conversationId, input.tenantSlug, userMessage.id)
  }

  // Gate de cobrança: se a assinatura existe mas não está ativa (E o flag está ligado), o
  // Hermes não gasta o cérebro caro — registra a mensagem e escala pra humano (o dono resolve:
  // paga ou responde manual). Grandfathering + flag desligado por padrão garantem que pilotos/
  // legado nunca são bloqueados. Ver app/lib/billing-gate.server.ts.
  const gate = await timer.step('billing', () => checkBillingGate(tenant.id))
  if (!gate.allowed) {
    ctx.outcome = 'billing_blocked'
    const userMessage = await timer.step('persist_user', async () => {
      const created = await db.message.create({
        data: { conversationId, role: 'user', content: message },
      })
      await db.conversation.update({
        where: { id: conversationId },
        data: operationalEffects ? { status: 'needs_human' } : { updatedAt: new Date() },
      })
      return created
    })
    return {
      conversationId,
      tenantSlug: input.tenantSlug,
      userMessageId: userMessage.id,
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
  if (guardForcesSafe) {
    // Tema sensível não escala em silêncio: num tenant de saúde isso pode ser uma
    // emergência esperando na fila. Push no celular do operador (best-effort) —
    // SÓ do canal real: a demo pública é anônima e viraria botão de spam urgente.
    if (guard.reason === 'sensitive_topic' && operationalEffects) {
      void reportSensitiveHandoff(input.tenantSlug)
    }
    const reply = configEfetiva.escalationPolicy.humanMessage
    // Mesma autorização do caminho longo. A janela aqui é de milissegundos (o guard não chama
    // o cérebro), mas o invariante é o mesmo — nenhuma mensagem de assistente entra numa
    // conversa que um humano conduz — e um invariante protegido em um caminho só vira bug no
    // outro na primeira vez que alguém mexer.
    const finalizacao = await timer.step('persist_reply', () =>
      db.$transaction(async (tx): Promise<Finalizacao> => {
        if (!(await autorizarEscrita(tx, conversationId))) {
          return { tipo: 'humano_assumiu' }
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
        if (operationalEffects) {
          await tx.conversation.update({
            where: { id: conversationId },
            data: { status: 'needs_human' },
          })
          await tx.handoffEvent.create({
            data: { conversationId, reason: guard.reason ?? 'unknown', message },
          })
        }
        return { tipo: 'ok', assistantMessageId: created.id }
      }, TRANSACAO_FINAL),
    )
    if (finalizacao.tipo === 'humano_assumiu') {
      ctx.outcome = 'human_handling'
      return silencioDoHumano(conversationId, input.tenantSlug, userMessage.id)
    }
    ctx.outcome = 'guard_handoff'
    return {
      conversationId,
      tenantSlug: input.tenantSlug,
      userMessageId: userMessage.id,
      assistantMessageId: finalizacao.assistantMessageId,
      reply,
      needsHuman: true,
      handoffReason: guard.reason,
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
  const reply = decision.reply
  const confidence = decision.confidence
  const sources: ProcessIncomingMessageSource[] = retrieved.map((chunk) => ({
    fileName: chunk.fileName,
    title: chunk.title,
    score: chunk.score,
  }))

  // ── TUDO O QUE A DECISÃO CAUSA, NUMA TRANSAÇÃO ────────────────────────────────
  //
  // O primeiro comando é o CAS de `autorizarEscrita`. Perder significa que o operador assumiu
  // durante o cérebro: nada é gravado, nem chamado, nem lead, nem resposta.
  //
  // Chamado e mensagem do assistente na MESMA transação, de propósito: se o chamado falhar, a
  // transação aborta e a resposta que afirma "registrei" não existe. A ordem antiga (chamado
  // fora, resposta depois) deixava a frase sobreviver ao chamado que não nasceu.
  const finalizacao = await timer.step('persist_reply', () =>
    db.$transaction(async (tx): Promise<Finalizacao> => {
      if (!(await autorizarEscrita(tx, conversationId))) {
        return { tipo: 'humano_assumiu' }
      }

      await timer.step('effects', async () => {
        if (!operationalEffects) {
          return
        }
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
      })

      const created = await tx.message.create({
        data: {
          conversationId,
          role: 'assistant',
          content: reply,
          confidence,
          sourcesJson: JSON.stringify(sources),
        },
      })

      // O `updatedAt` já foi tocado por `autorizarEscrita` — sem ele, a resolução de
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
    }, TRANSACAO_FINAL),
  )

  if (finalizacao.tipo === 'humano_assumiu') {
    ctx.outcome = 'human_handling'
    return silencioDoHumano(conversationId, input.tenantSlug, userMessage.id)
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
