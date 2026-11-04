// CARACTERIZAÇÃO DO DRIVER — a premissa que sustenta a fronteira da transação.
//
// `fronteira-transacao.test.ts` garante que ninguém escreveu uma espera externa dentro de uma
// transação. Só que ele guarda o NOSSO código; a outra metade da segurança não é nossa:
//
//   better-sqlite3 é síncrono + o adapter resolve com `Promise.resolve`
//     → todo `await tx.*` é microtask
//     → a fila de microtasks drena inteira antes de o event loop voltar às fases de
//       timers/poll/check
//     → entre o BEGIN e o COMMIT o processo não atende mais nada
//     → a escrita de outra requisição não tem por onde entrar na transação alheia
//
// Se um `npm install` trocar o adapter por um assíncrono (libsql, node:sqlite async, qualquer
// driver de rede), TODA query dentro da transação vira um ponto de yield, o cenário que hoje é
// inalcançável passa a ser rotineiro, e a serialização deixa de ser opcional. Nada no código de
// conversa mudaria — e nenhum teste de comportamento quebraria. Este aqui quebra.
//
// Ele não substitui a guarda estrutural: os dois protegem lados diferentes do mesmo raciocínio.
//   fronteira-transacao  → ninguém introduziu espera externa
//   driver-sincrono      → o driver continua síncrono como presumimos

import { describe, expect, it } from 'vitest'
import { db } from '../db.server'

describe('caracterização do driver', () => {
  it('a transação vai de ponta a ponta sem devolver o controle ao event loop', async () => {
    const tenant = await db.tenant.create({
      data: { slug: `drv-${Date.now()}-${Math.round(performance.now())}`, name: 'Driver' },
    })

    // UMA macrotask só, agendada DENTRO da transação, prova as duas fases:
    //   antes do commit → não rodou (a transação não devolveu o controle)
    //   depois do commit → rodou    (o event loop volta a girar, logo ela existia mesmo)
    //
    // Uma versão anterior deste teste media duas macrotasks diferentes: guardava o sinal da
    // de dentro e conferia a sanidade na de FORA, agendada antes até de criar o tenant. Essa
    // podia ter rodado durante qualquer `await` do preâmbulo, então a sanidade passava sem
    // dizer nada sobre a macrotask que realmente importa — se a de dentro jamais fosse
    // agendada, o teste ficava verde medindo nada.
    let macrotaskInternaRodou = false
    let rodouAntesDoCommit: boolean | null = null
    let conversaId = ''

    try {
      await db.$transaction(async (tx) => {
        setImmediate(() => {
          macrotaskInternaRodou = true
        })

        // Várias idas ao banco: se alguma devolvesse o controle, a macrotask teria rodado.
        const conversa = await tx.conversation.create({
          data: { tenantId: tenant.id, channel: 'whatsapp', contactId: 'drv', status: 'open' },
        })
        await tx.message.create({
          data: { conversationId: conversa.id, role: 'user', content: 'oi' },
        })
        await tx.conversation.updateMany({
          where: { id: conversa.id, status: { not: 'human' } },
          data: { updatedAt: new Date() },
        })
        await tx.message.create({
          data: { conversationId: conversa.id, role: 'assistant', content: 'olá' },
        })

        conversaId = conversa.id
        rodouAntesDoCommit = macrotaskInternaRodou
      })

      expect(
        rodouAntesDoCommit,
        'Uma macrotask executou DENTRO da transação: o driver deixou de ser síncrono.\n' +
          'A premissa que torna `fronteira-transacao.test.ts` suficiente caiu — a partir daqui\n' +
          'uma escrita de outra requisição PODE aterrissar dentro de uma transação aberta,\n' +
          'ser sobrescrita pelo que vier depois ou ser desfeita pelo rollback.\n' +
          'Serializar motor e operador deixa de ser opcional. Ver o cabeçalho deste arquivo.',
      ).toBe(false)

      // A MESMA macrotask, agora que o event loop voltou a girar. Sem isto, um teste que nunca
      // agendasse nada passaria na asserção de cima sem medir coisa alguma.
      await new Promise((resolve) => setImmediate(resolve))
      expect(
        macrotaskInternaRodou,
        'a macrotask interna nunca rodou — o teste não está medindo a fronteira',
      ).toBe(true)
    } finally {
      // O banco é por worker, mas é COMPARTILHADO pelos testes daquele worker: sem limpar,
      // este teste vira estado de fundo para quem roda depois (contagem contaminada, e a base
      // crescendo a cada repetição durante uma sessão de mutação).
      if (conversaId) {
        await db.message.deleteMany({ where: { conversationId: conversaId } })
        await db.conversation.deleteMany({ where: { id: conversaId } })
      }
      await db.tenant.deleteMany({ where: { id: tenant.id } })
    }
  })
})
