import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db.server'
import type { AttendantOutput } from './attendant/types'

// A CORRIDA: o operador assume ENQUANTO o cérebro está pensando.
//
// A guarda de silêncio lê o status UMA VEZ, antes do cérebro — e o cérebro é a chamada mais
// lenta do fluxo (dezenas de segundos com o provider real). No meio dela o operador clica
// "assumir". Sem um ponto de linearização, o motor terminava e gravava a resposta da IA
// dentro da conversa que o atendente acabou de assumir, criava chamado, enriquecia lead e —
// no WhatsApp — a resposta ainda saía para o cliente.
//
// Este arquivo usa um cérebro PAUSÁVEL: ele sinaliza que entrou e espera ser liberado. Sem
// essa barreira o teste não prova a corrida, só a ordem em que o teste por acaso rodou.

const cerebro = vi.hoisted(() => {
  function barreira() {
    let abrir: () => void = () => {}
    const esperar = new Promise<void>((resolver) => {
      abrir = resolver
    })
    return { esperar, abrir }
  }
  return {
    barreira,
    entrou: barreira(),
    liberar: barreira(),
    chamadas: 0,
    saida: null as AttendantOutput | null,
    reiniciar() {
      this.entrou = barreira()
      this.liberar = barreira()
      this.chamadas = 0
    },
  }
})

vi.mock('./attendant/providers/mock', () => ({
  mockProvider: {
    name: 'mock',
    generate: async (): Promise<AttendantOutput> => {
      cerebro.chamadas += 1
      cerebro.entrou.abrir()
      await cerebro.liberar.esperar
      if (!cerebro.saida) {
        throw new Error('teste não definiu a saída do cérebro')
      }
      return cerebro.saida
    },
  },
}))

// Barreira na base de conhecimento: é o único ponto de espera entre a leitura do status e o
// caminho do GUARD determinístico, que não chama o cérebro. Fechada só quando um teste pede.
const base = vi.hoisted(() => ({
  pausa: null as Promise<void> | null,
  entrou: null as { esperar: Promise<void>; abrir: () => void } | null,
}))

vi.mock('./knowledge-db.server', () => ({
  resolveKnowledge: async () => {
    base.entrou?.abrir()
    if (base.pausa) {
      await base.pausa
    }
    return [
      {
        tenantSlug: 'dgc',
        fileName: 'base.md',
        title: 'Base',
        content: 'Atendemos das 9h às 18h.',
      },
    ]
  },
}))

vi.mock('./alarm.server', () => ({
  reportDegradation: vi.fn(),
  reportSensitiveHandoff: vi.fn(),
}))

const { processIncomingMessage } = await import('./conversation.server')
const { reportDegradation, reportSensitiveHandoff } = await import('./alarm.server')

const CONTATO = 'test-corrida-humano'

/** Saída que causaria TODOS os efeitos: chamado, lead e escalação. */
const SAIDA_COM_EFEITOS: AttendantOutput = {
  reply: 'Pronto, já registrei seu chamado.',
  needsHuman: true,
  handoffReason: 'caso_complexo',
  leadPatch: { name: 'Maria' },
  confidence: 0.8,
  action: {
    type: 'abrir_chamado',
    subject: 'troca de plantao',
    description: 'cliente pediu troca de plantao',
  },
}

let conversaId: string

beforeEach(async () => {
  cerebro.reiniciar()
  cerebro.saida = SAIDA_COM_EFEITOS
  base.pausa = null
  base.entrou = null
  vi.clearAllMocks()

  const tenant = await db.tenant.upsert({
    where: { slug: 'dgc' },
    update: {},
    create: { slug: 'dgc', name: 'DGC Hub' },
  })
  conversaId = (
    await db.conversation.create({
      data: { tenantId: tenant.id, contactId: CONTATO, channel: 'whatsapp', status: 'open' },
    })
  ).id
})

afterEach(async () => {
  await db.ticket.deleteMany({ where: { contactId: CONTATO } })
  await db.handoffEvent.deleteMany({ where: { conversationId: conversaId } })
  await db.lead.deleteMany({ where: { conversationId: conversaId } })
  await db.message.deleteMany({ where: { conversationId: conversaId } })
  await db.conversation.deleteMany({ where: { id: conversaId } })
})

describe('operador assume durante o cérebro', () => {
  it('a resposta é SUPRIMIDA e nenhum efeito acontece', async () => {
    // A mensagem não tem sinal de lead (telefone, bairro): assim um Lead com `name: 'Maria'`
    // só pode ter vindo da DECISÃO do cérebro, que é o que este teste mede.
    const processamento = processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'preciso de ajuda com uma coisa',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    // Espera COMPROVADA de que o cérebro entrou — não um `setTimeout` otimista.
    await cerebro.entrou.esperar

    // O clique do operador, no meio do raciocínio.
    await db.conversation.update({ where: { id: conversaId }, data: { status: 'human' } })

    cerebro.liberar.abrir()
    const r = await processamento

    // O motor perdeu a corrida e se cala.
    expect(r.humanHandling).toBe(true)
    expect(r.reply).toBe('')
    expect(r.assistantMessageId).toBe('')

    // Só a fala do cliente ficou gravada: nenhuma resposta da IA na conversa assumida.
    const papeis = (
      await db.message.findMany({ where: { conversationId: conversaId }, select: { role: true } })
    ).map((m) => m.role)
    expect(papeis).toEqual(['user'])

    // E nenhum efeito derivado da decisão.
    expect(await db.ticket.count({ where: { contactId: CONTATO } })).toBe(0)
    expect(await db.lead.count({ where: { conversationId: conversaId, name: 'Maria' } })).toBe(0)
    expect(await db.handoffEvent.count({ where: { conversationId: conversaId } })).toBe(0)
    // Nem alarme: não houve resposta genérica entregue a cliente nenhum.
    expect(reportDegradation).not.toHaveBeenCalled()

    // O status do humano permanece — o motor não o sobrescreveu com `needs_human`.
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conversaId } })).status).toBe(
      'human',
    )
  })

  it('sem tomada humana, a MESMA saída executa tudo — o par positivo', async () => {
    // Sem este, um ponto de linearização que suprimisse sempre ficaria verde e mataria o
    // atendimento inteiro.
    const processamento = processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'preciso de ajuda com uma coisa',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    await cerebro.entrou.esperar
    cerebro.liberar.abrir()
    const r = await processamento

    expect(r.humanHandling).toBeUndefined()
    expect(r.reply).toContain('registrei')
    expect(r.assistantMessageId).not.toBe('')
    expect(await db.ticket.count({ where: { contactId: CONTATO } })).toBe(1)
    expect(await db.lead.count({ where: { conversationId: conversaId, name: 'Maria' } })).toBe(1)
    expect(await db.handoffEvent.count({ where: { conversationId: conversaId } })).toBe(1)
  })

  it('o motor vence o CAS e a tomada POSTERIOR preserva a resposta do instante anterior', async () => {
    // O OUTRO LADO da linearização. O teste de cima prova "tomada vence"; sem este, um CAS
    // que suprimisse SEMPRE ficaria verde lá em cima — e o Hermes pararia de responder.
    //
    // Por que estas são as duas únicas ordenações que existem: a terceira que se imagina —
    // o operador entrando DEPOIS do CAS e ANTES do commit — não é alcançável nesta
    // topologia. Entre o `BEGIN` e o `COMMIT` a transação não devolve o controle ao event
    // loop, então nenhuma outra requisição executa ali no meio. Quem guarda essa premissa é
    // `driver-sincrono.test.ts`; quem guarda o código contra reintroduzi-la é
    // `fronteira-transacao.test.ts`. Aqui a gente prova o comportamento observável.
    const processamento = processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'preciso de ajuda com uma coisa',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    await cerebro.entrou.esperar
    cerebro.liberar.abrir()
    const r = await processamento

    // O motor atravessou o CAS e commitou: a resposta pertence ao instante ANTERIOR à tomada.
    expect(r.humanHandling).toBeUndefined()
    expect(r.assistantMessageId).not.toBe('')
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conversaId } })).status).toBe(
      'needs_human',
    )

    // Só AGORA o operador assume — depois do commit, que é quando a tomada de fato cabe.
    await db.conversation.update({ where: { id: conversaId }, data: { status: 'human' } })

    // A tomada posterior NÃO desfaz o que já era do instante anterior: a resposta continua
    // gravada, e os efeitos que ela causou continuam de pé. O operador assume a conversa
    // como ela está, não uma conversa mutilada.
    const papeis = (
      await db.message.findMany({
        where: { conversationId: conversaId },
        orderBy: { createdAt: 'asc' },
        select: { role: true },
      })
    ).map((m) => m.role)
    expect(papeis).toEqual(['user', 'assistant'])
    expect(await db.ticket.count({ where: { contactId: CONTATO } })).toBe(1)
    expect(await db.handoffEvent.count({ where: { conversationId: conversaId } })).toBe(1)

    // E a autoridade passou para o humano a partir daqui.
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conversaId } })).status).toBe(
      'human',
    )
  })

  it('no caminho do GUARD, a tomada humana suprime a resposta e o ALARME', async () => {
    // Tema sensível não passa pelo cérebro: o guard decide sozinho. A janela é de
    // milissegundos, e a barreira aqui é a base de conhecimento — o único await entre a
    // leitura do status e a autorização de escrita.
    //
    // O alarme importa tanto quanto a mensagem: um push dizendo "escalação sensível" para um
    // operador que JÁ está na conversa avisa de algo que não aconteceu. Era a mesma assimetria
    // que a revisão apontou no alarme de degradação, e ela tinha ficado neste caminho.
    base.entrou = cerebro.barreira()
    const liberar = cerebro.barreira()
    base.pausa = liberar.esperar

    const processamento = processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'preciso falar sobre o contrato e meus dados pessoais',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    await base.entrou.esperar
    await db.conversation.update({ where: { id: conversaId }, data: { status: 'human' } })
    liberar.abrir()
    const r = await processamento

    expect(r.humanHandling).toBe(true)
    expect(r.assistantMessageId).toBe('')
    expect(
      (
        await db.message.findMany({ where: { conversationId: conversaId }, select: { role: true } })
      ).map((m) => m.role),
    ).toEqual(['user'])
    expect(await db.handoffEvent.count({ where: { conversationId: conversaId } })).toBe(0)
    expect(reportSensitiveHandoff).not.toHaveBeenCalled()
    // O cérebro nunca foi chamado: o guard curto-circuitou, como deve.
    expect(cerebro.chamadas).toBe(0)
  })

  it('sem tomada, o GUARD escala e o alarme dispara — o par positivo', async () => {
    const r = await processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'preciso falar sobre o contrato e meus dados pessoais',
      contactId: CONTATO,
      mode: 'whatsapp',
    })

    expect(r.needsHuman).toBe(true)
    expect(r.assistantMessageId).not.toBe('')
    expect(await db.handoffEvent.count({ where: { conversationId: conversaId } })).toBe(1)
    expect(reportSensitiveHandoff).toHaveBeenCalledTimes(1)
  })

  it('em owner_preview a tomada humana também suprime a resposta', async () => {
    // O preview não cria efeitos, mas ainda GRAVA mensagem: sem o ponto de linearização, a
    // resposta de teste entraria na conversa que o atendente assumiu.
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: 'dgc' } })
    const conversaPreview = await db.conversation.create({
      data: {
        tenantId: tenant.id,
        contactId: `${CONTATO}-preview`,
        channel: 'simulator',
        status: 'open',
      },
    })

    const processamento = processIncomingMessage({
      tenantSlug: 'dgc',
      message: 'preciso de ajuda com uma coisa',
      contactId: `${CONTATO}-preview`,
      mode: 'owner_preview',
    })

    await cerebro.entrou.esperar
    await db.conversation.update({
      where: { id: conversaPreview.id },
      data: { status: 'human' },
    })
    cerebro.liberar.abrir()
    const r = await processamento

    expect(r.humanHandling).toBe(true)
    expect(r.assistantMessageId).toBe('')
    const papeis = (
      await db.message.findMany({
        where: { conversationId: conversaPreview.id },
        select: { role: true },
      })
    ).map((m) => m.role)
    expect(papeis).toEqual(['user'])

    await db.message.deleteMany({ where: { conversationId: conversaPreview.id } })
    await db.conversation.delete({ where: { id: conversaPreview.id } })
  })
})
