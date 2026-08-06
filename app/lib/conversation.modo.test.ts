import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'

// O CONTRATO DO `ExecutionMode` (spec §7.2).
//
// Duas metades. A primeira é de TIPO: combinações perigosas têm que falhar na compilação, e
// `@ts-expect-error` é o que prova isso — se a combinação passar a compilar, o próprio
// `tsc` reclama do comentário sobrando. A segunda é de comportamento: o que cada modo faz
// com efeitos e alarme.
//
// Este arquivo existe separado porque `vi.mock` do alarme vale para o módulo inteiro, e os
// testes de conversa de `conversation.server.test.ts` não devem depender disso.

vi.mock('./alarm.server', () => ({
  reportDegradation: vi.fn(),
  reportSensitiveHandoff: vi.fn(),
}))

const { processIncomingMessage } = await import('./conversation.server')
const { reportSensitiveHandoff } = await import('./alarm.server')
const { safeDefaultConfig } = await import('./attendant/tenant-config')

/**
 * Um snapshot VÁLIDO por forma.
 *
 * Importa que seja válido: com `{ config: {} }` o `@ts-expect-error` capturava o erro de
 * FORMA do fixture, não o `previewSnapshot?: never` — e o teste passava sem provar nada.
 * Descoberto por mutação: relaxar o `never` não derrubava o typecheck.
 */
const SNAPSHOT_VALIDO = { config: safeDefaultConfig('dgc'), conhecimento: [] }

const CONTATO = 'test-modo-execucao'

/** Mensagem com tema sensível: é o gatilho de `reportSensitiveHandoff` (handoff.ts). */
const TEMA_SENSIVEL = 'preciso falar sobre o contrato e meus dados pessoais'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await db.ticket.deleteMany({ where: { contactId: CONTATO } })
  const conversas = await db.conversation.findMany({
    where: { contactId: CONTATO },
    select: { id: true },
  })
  const ids = conversas.map((c) => c.id)
  if (ids.length === 0) {
    return
  }
  await db.handoffEvent.deleteMany({ where: { conversationId: { in: ids } } })
  await db.lead.deleteMany({ where: { conversationId: { in: ids } } })
  await db.message.deleteMany({ where: { conversationId: { in: ids } } })
  await db.conversation.deleteMany({ where: { id: { in: ids } } })
})

describe('o modo é obrigatório e as combinações inválidas não compilam', () => {
  // CADA FIXTURE VIOLA UMA REGRA SÓ.
  //
  // Quando `contactId` passou a ser obrigatório, este arquivo continuou compilando — e por
  // um motivo ruim: os fixtures omitiam `contactId` TAMBÉM, então cada `@ts-expect-error`
  // capturava duas violações e deixaria de provar a sua no dia em que a outra saísse. É a
  // mesma armadilha do `{ config: {} }` de antes.
  it('omitir o modo é erro de tipo', () => {
    // @ts-expect-error — SÓ `mode` está ausente: era possível chamar o motor sem dizer se
    // havia um cliente do outro lado, e o default silencioso ligava os efeitos.
    const semModo: Parameters<typeof processIncomingMessage>[0] = {
      tenantSlug: 'dgc',
      contactId: CONTATO,
      message: 'oi',
    }
    expect(semModo).toBeTruthy()
  })

  it('omitir o contato é erro de tipo', () => {
    // @ts-expect-error — SÓ `contactId` está ausente. Sem ele, a conferência do dono da
    // conversa era pulada e qualquer conversa do mesmo tenant e canal era aceita.
    const semContato: Parameters<typeof processIncomingMessage>[0] = {
      tenantSlug: 'dgc',
      message: 'oi',
      mode: 'whatsapp',
    }
    expect(semContato).toBeTruthy()
  })

  it('whatsapp com snapshot da candidata é erro de tipo', () => {
    // O pior desfecho da fatia: config em revisão atendendo cliente real. A barreira é o
    // compilador, não uma checagem que alguém pode esquecer de escrever.
    // A diretiva fica na ATRIBUIÇÃO, não na propriedade: o TypeScript atribui a
    // incompatibilidade de união ao objeto inteiro, e um `@ts-expect-error` na linha do campo
    // ficaria "sem uso" (TS2578) enquanto o erro real apareceria aqui.
    // @ts-expect-error — `previewSnapshot?: never` em `whatsapp`. O snapshot é válido por
    // forma de propósito: o único erro tem que ser o `never`.
    const invalido: Parameters<typeof processIncomingMessage>[0] = {
      tenantSlug: 'dgc',
      contactId: CONTATO,
      message: 'oi',
      mode: 'whatsapp',
      previewSnapshot: SNAPSHOT_VALIDO,
    }
    expect(invalido).toBeTruthy()
  })

  it('demo pública com snapshot da candidata é erro de tipo', () => {
    // A demo é vitrine para desconhecido: material em revisão não pode aparecer lá.
    // @ts-expect-error — `previewSnapshot?: never` em `public_demo`. Snapshot válido por
    // forma: o único erro tem que ser o `never`.
    const invalido: Parameters<typeof processIncomingMessage>[0] = {
      tenantSlug: 'dgc',
      contactId: CONTATO,
      message: 'oi',
      mode: 'public_demo',
      previewSnapshot: SNAPSHOT_VALIDO,
    }
    expect(invalido).toBeTruthy()
  })

  it('modo inventado é erro de tipo', () => {
    const invalido: Parameters<typeof processIncomingMessage>[0] = {
      tenantSlug: 'dgc',
      contactId: CONTATO,
      message: 'oi',
      // @ts-expect-error — só os três da §7.2 existem.
      mode: 'qualquer_coisa',
    }
    expect(invalido).toBeTruthy()
  })
})

describe('o runtime também recusa: o tipo não é a única barreira', () => {
  // O tipo some na compilação. Um `as`, um chamador em JavaScript, dado vindo de JSON ou uma
  // borda futura mais frouxa ainda montam a combinação — e o desfecho é a candidata em
  // revisão atendendo cliente real. Aqui a combinação é forçada COM cast, de propósito: é
  // assim que ela chegaria na vida real.
  function forcar(mode: string) {
    return {
      tenantSlug: 'dgc',
      message: 'meu telefone é 11999998888',
      contactId: CONTATO,
      mode,
      previewSnapshot: SNAPSHOT_VALIDO,
    } as unknown as Parameters<typeof processIncomingMessage>[0]
  }

  /** Nada aconteceu: nem conversa, nem mensagem, nem efeito, nem alarme. */
  async function nadaAconteceu() {
    const conversas = await db.conversation.findMany({
      where: { contactId: CONTATO },
      select: { id: true },
    })
    expect(conversas).toHaveLength(0)
    expect(await db.message.count({ where: { conversation: { contactId: CONTATO } } })).toBe(0)
    expect(await db.lead.count({ where: { conversation: { contactId: CONTATO } } })).toBe(0)
    expect(await db.ticket.count({ where: { contactId: CONTATO } })).toBe(0)
    expect(reportSensitiveHandoff).not.toHaveBeenCalled()
  }

  it.each([
    'whatsapp',
    'public_demo',
  ])('%s com snapshot é recusado em runtime, com mensagem fixa', async (mode) => {
    await expect(processIncomingMessage(forcar(mode))).rejects.toThrow(
      'Preview snapshot requires owner preview mode',
    )
    await nadaAconteceu()
  })

  it('modo inexistente é recusado em runtime', async () => {
    await expect(processIncomingMessage(forcar('modo_inventado'))).rejects.toThrow(
      'Invalid execution mode',
    )
    await nadaAconteceu()
  })

  it.each([
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    '__proto__',
  ])('recusa a chave HERDADA "%s" como modo', async (mode) => {
    // A tabela de perfis é um objeto comum: `PERFIL_DO_MODO['constructor']` devolve uma
    // FUNÇÃO, que é truthy. A checagem antiga (`if (!perfil)`) deixava passar, e a
    // desestruturação dava `channel: undefined`. O elo que fecha o estrago é o Prisma:
    // filtro `undefined` é OMITIDO, então a busca da conversa perdia o filtro de canal e
    // podia reusar a conversa real de WhatsApp de um cliente.
    //
    // Sem snapshot no fixture, de propósito: assim o erro só pode ser o do modo.
    const input = {
      tenantSlug: 'dgc',
      contactId: CONTATO,
      message: 'oi',
      mode,
    } as unknown as Parameters<typeof processIncomingMessage>[0]

    await expect(processIncomingMessage(input)).rejects.toThrow('Invalid execution mode')
    await nadaAconteceu()
  })

  it('contato ausente é recusado em runtime, antes de ler conversa', async () => {
    const input = {
      tenantSlug: 'dgc',
      message: 'oi',
      mode: 'whatsapp',
    } as unknown as Parameters<typeof processIncomingMessage>[0]

    await expect(processIncomingMessage(input)).rejects.toThrow('Contact identity is required')
    await nadaAconteceu()
  })

  it.each(['', '   '])('contato vazio ("%s") também é recusado', async (contactId) => {
    const input = {
      tenantSlug: 'dgc',
      contactId,
      message: 'oi',
      mode: 'whatsapp',
    } as unknown as Parameters<typeof processIncomingMessage>[0]

    await expect(processIncomingMessage(input)).rejects.toThrow('Contact identity is required')
  })

  it('a mensagem de recusa NÃO leva nada do snapshot', async () => {
    const erro = await processIncomingMessage(forcar('whatsapp')).catch((e: unknown) => e)

    // PRIMEIRO prova que a recusa aconteceu. Sem esta linha o teste passava com a guarda
    // REMOVIDA: a chamada tinha sucesso, `erro` virava o objeto de resultado, e
    // `String(objeto)` é '[object Object]' — que de fato não contém 'dgc'. Um teste de
    // não-vazamento que não confirma o vazamento estar no caminho não prova nada.
    expect(erro).toBeInstanceOf(Error)
    const texto = (erro as Error).message
    expect(texto).toBe('Preview snapshot requires owner preview mode')

    expect(texto).not.toContain('dgc')
    expect(texto).not.toContain('knowledge/')
  })

  it('owner_preview COM snapshot executa — o par positivo', async () => {
    // Sem este, uma guarda que recusasse todo snapshot ficaria verde e mataria a etapa.
    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi',
      contactId: CONTATO,
      mode: 'owner_preview',
      previewSnapshot: SNAPSHOT_VALIDO,
    })

    expect(r.conversationId).toBeTruthy()
  })
})

describe('a conversa reutilizada tem que ser do canal do modo', () => {
  /** Cria uma conversa direto no banco, no canal e contato pedidos. */
  async function conversaExistente(channel: string, contactId = CONTATO) {
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: 'dgc' } })
    return db.conversation.create({
      data: { tenantId: tenant.id, contactId, channel, status: 'open' },
    })
  }

  it('owner_preview NÃO pode usar uma conversa de WhatsApp real', async () => {
    // O caso concreto: com o id da conversa real de um cliente, o preview leria o histórico
    // dele, o lead e os chamados, mandaria isso ao cérebro e gravaria as mensagens de teste
    // dentro do atendimento. Nada sai para fora, e ainda assim é mistura e exposição.
    const real = await conversaExistente('whatsapp')

    await expect(
      processIncomingMessage({
        tenantSlug: 'dgc',
        message: 'oi',
        conversationId: real.id,
        contactId: CONTATO,
        mode: 'owner_preview',
      }),
    ).rejects.toThrow('Conversation not found')

    expect(await db.message.count({ where: { conversationId: real.id } })).toBe(0)
  })

  it('whatsapp NÃO pode usar uma conversa de simulador', async () => {
    const teste = await conversaExistente('simulator')

    await expect(
      processIncomingMessage({
        tenantSlug: 'dgc',
        message: 'oi',
        conversationId: teste.id,
        contactId: CONTATO,
        mode: 'whatsapp',
      }),
    ).rejects.toThrow('Conversation not found')

    expect(await db.message.count({ where: { conversationId: teste.id } })).toBe(0)
  })

  it('conversa de outra pessoa com o contato OMITIDO é recusada', async () => {
    // Era o bypass: sem `contactId`, a conferência do dono era pulada e qualquer conversa do
    // mesmo tenant e canal passava. O motor leria o histórico, o lead e os chamados da
    // vítima, mandaria tudo ao cérebro e gravaria a resposta na conversa dela.
    const vitima = await conversaExistente('whatsapp', `${CONTATO}-vitima`)

    const hostil = {
      tenantSlug: 'dgc',
      conversationId: vitima.id,
      message: 'oi',
      mode: 'whatsapp',
      // contactId OMITIDO de propósito
    } as unknown as Parameters<typeof processIncomingMessage>[0]

    await expect(processIncomingMessage(hostil)).rejects.toThrow('Contact identity is required')
    expect(await db.message.count({ where: { conversationId: vitima.id } })).toBe(0)

    await db.conversation.delete({ where: { id: vitima.id } })
  })

  it('conversa de OUTRA EMPRESA, com canal e contato IGUAIS, é recusada', async () => {
    // Os testes anteriores usavam só o tenant `dgc`, então remover a comparação de tenant
    // sobrevivia a todos. Aqui canal e contato são idênticos DE PROPÓSITO: o único campo que
    // discrimina é o tenant, e é isso que torna a prova dele possível.
    const outra = await db.tenant.upsert({
      where: { slug: 'assistencia-tecnica-demo' },
      update: {},
      create: { slug: 'assistencia-tecnica-demo', name: 'Outra Empresa' },
    })
    const alheia = await db.conversation.create({
      data: { tenantId: outra.id, contactId: CONTATO, channel: 'whatsapp', status: 'open' },
    })

    await expect(
      processIncomingMessage({
        tenantSlug: 'dgc', // ← tenant da chamada
        message: 'oi',
        conversationId: alheia.id, // ← conversa da outra empresa
        contactId: CONTATO, // ← contato IGUAL
        mode: 'whatsapp', // ← canal IGUAL
      }),
    ).rejects.toThrow('Conversation not found')

    // Nada foi lido nem gravado na conversa alheia.
    expect(await db.message.count({ where: { conversationId: alheia.id } })).toBe(0)

    await db.conversation.delete({ where: { id: alheia.id } })
  })

  it('conversa de OUTRO contato do mesmo canal é recusada', async () => {
    const deOutro = await conversaExistente('whatsapp', `${CONTATO}-outro`)

    await expect(
      processIncomingMessage({
        tenantSlug: 'dgc',
        message: 'oi',
        conversationId: deOutro.id,
        contactId: CONTATO,
        mode: 'whatsapp',
      }),
    ).rejects.toThrow('Conversation not found')

    await db.conversation.delete({ where: { id: deOutro.id } })
  })

  it.each([
    ['whatsapp', 'whatsapp'],
    ['owner_preview', 'simulator'],
  ] as const)('%s reutiliza a conversa de canal %s do mesmo contato', async (mode, channel) => {
    // Os pares positivos: sem eles, uma guarda que recusasse sempre ficaria verde.
    const minha = await conversaExistente(channel)

    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi',
      conversationId: minha.id,
      contactId: CONTATO,
      mode,
    })

    expect(r.conversationId).toBe(minha.id)
  })

  it('sem conversationId, a busca por identidade também respeita o canal', async () => {
    // O outro caminho de reutilização. A conversa de WhatsApp existe e está ativa; o preview
    // tem que abrir uma NOVA, no canal dele, em vez de continuar naquela.
    const real = await conversaExistente('whatsapp')

    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi',
      contactId: CONTATO,
      mode: 'owner_preview',
    })

    expect(r.conversationId).not.toBe(real.id)
    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId } })).channel,
    ).toBe('simulator')
  })
})

describe('"um humano assumiu" vale em TODOS os modos', () => {
  // O silêncio quando um atendente assume é um ESTADO a ser obedecido, não um efeito a ser
  // condicionado por `operationalEffects`. Enquanto estava condicionado, em `public_demo` e
  // `owner_preview` a IA gravava `role: 'assistant'` dentro da conversa que o atendente
  // estava conduzindo — indistinguível da fala dele na ficha de `/atendente`.
  //
  // Alcançável sem cast: a fila do atendente não filtra canal, então uma conversa de demo ou
  // de simulador pode ser assumida, e a busca por identidade a reutiliza na visita seguinte.

  /** Conversa já assumida por um humano, no canal pedido. */
  async function assumidaPorHumano(channel: string, contactId: string) {
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: 'dgc' } })
    return db.conversation.create({
      data: { tenantId: tenant.id, contactId, channel, status: 'human' },
    })
  }

  it.each([
    ['public_demo', 'simulator'],
    ['owner_preview', 'simulator'],
    ['whatsapp', 'whatsapp'],
  ] as const)('%s se cala e NÃO grava resposta da IA', async (mode, channel) => {
    const contato = `${CONTATO}-${mode}`
    const conversa = await assumidaPorHumano(channel, contato)

    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'oi, tem alguém aí?',
      contactId: contato,
      mode,
    })

    expect(r.conversationId).toBe(conversa.id)
    expect(r.humanHandling).toBe(true)
    expect(r.reply).toBe('')
    expect(r.assistantMessageId).toBe('')

    // A prova que importa: só a fala do CLIENTE ficou gravada.
    const papeis = (
      await db.message.findMany({
        where: { conversationId: conversa.id },
        select: { role: true },
      })
    ).map((m) => m.role)
    expect(papeis).toEqual(['user'])

    await db.message.deleteMany({ where: { conversationId: conversa.id } })
    await db.conversation.delete({ where: { id: conversa.id } })
  })
})

describe('o alarme de tema sensível segue os EFEITOS, não o canal', () => {
  it('whatsapp alarma', async () => {
    // Num tenant de saúde isso pode ser uma emergência esperando na fila: o push existe
    // para o operador não descobrir horas depois.
    await processIncomingMessage({
      tenantSlug: 'dgc',
      message: TEMA_SENSIVEL,
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    expect(reportSensitiveHandoff).toHaveBeenCalledTimes(1)
  })

  it('owner_preview NÃO alarma', async () => {
    // O dono testando a própria IA não pode disparar push no celular dele mesmo — e antes
    // isso dependia de o chamador lembrar de mandar `channel: 'simulator'`.
    await processIncomingMessage({
      tenantSlug: 'dgc',
      message: TEMA_SENSIVEL,
      contactId: CONTATO,
      mode: 'owner_preview',
    })

    expect(reportSensitiveHandoff).not.toHaveBeenCalled()
  })

  it('public_demo NÃO alarma', async () => {
    // Visitante anônimo digitando "contrato" na vitrine viraria botão de spam urgente.
    await processIncomingMessage({
      tenantSlug: 'dgc',
      message: TEMA_SENSIVEL,
      contactId: CONTATO,
      mode: 'public_demo',
    })

    expect(reportSensitiveHandoff).not.toHaveBeenCalled()
  })
})

describe('efeitos operacionais por modo', () => {
  it('whatsapp escala a conversa e registra o handoff', async () => {
    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'quero falar com um humano',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId } })).status,
    ).toBe('needs_human')
    expect(await db.handoffEvent.count({ where: { conversationId: r.conversationId } })).toBe(1)
  })

  it.each([
    'owner_preview',
    'public_demo',
  ] as const)('%s não escala a conversa nem registra handoff', async (mode) => {
    // Para `public_demo` isto CORRIGE comportamento (§7.3): a demo marcava a conversa como
    // `needs_human` e criava o evento, e a Central do cliente recebia visitante anônimo na
    // fila — gente que ele não tem como atender e que nunca pediu atendimento.
    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'quero falar com um humano',
      contactId: CONTATO,
      mode,
    })

    expect(r.needsHuman).toBe(true) // quem chamou SABE; o balcão é que não age
    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId } })).status,
    ).toBe('open')
    expect(await db.handoffEvent.count({ where: { conversationId: r.conversationId } })).toBe(0)
  })

  it('o canal do trace vem do modo', async () => {
    // A métrica por canal não pode discordar do que executou: antes o canal era um campo
    // livre do chamador, e `channel: 'whatsapp'` com `preview: true` era escrevível.
    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'vocês fazem automação?',
      contactId: CONTATO,
      mode: 'owner_preview',
    })

    // O trace é best-effort e assíncrono; o que importa aqui é a conversa, que é síncrona.
    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: r.conversationId } })).channel,
    ).toBe('simulator')
  })
})
