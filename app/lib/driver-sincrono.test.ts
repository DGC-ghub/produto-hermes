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
    // Uma macrotask agendada ANTES da transação. Ela só executa quando o event loop chega à
    // fase de check — ou seja, quando alguém devolve o controle.
    let macrotaskRodou = false
    setImmediate(() => {
      macrotaskRodou = true
    })

    const tenant = await db.tenant.create({
      data: { slug: `drv-${Date.now()}-${Math.round(performance.now())}`, name: 'Driver' },
    })

    // A macrotask pode ter rodado durante os awaits acima — o que importa é o de dentro.
    let rodouAntesDoCommit: boolean | null = null

    await db.$transaction(async (tx) => {
      let dentro = false
      setImmediate(() => {
        dentro = true
      })

      // Várias idas ao banco: se alguma devolvesse o controle, a macrotask acima teria rodado.
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

      rodouAntesDoCommit = dentro
    })

    expect(
      rodouAntesDoCommit,
      'Uma macrotask executou DENTRO da transação: o driver deixou de ser síncrono.\n' +
        'A premissa que torna `fronteira-transacao.test.ts` suficiente caiu — a partir daqui\n' +
        'uma escrita de outra requisição PODE aterrissar dentro de uma transação aberta,\n' +
        'ser sobrescrita pelo que vier depois ou ser desfeita pelo rollback.\n' +
        'Serializar motor e operador deixa de ser opcional. Ver o cabeçalho deste arquivo.',
    ).toBe(false)

    // Sanidade: fora da transação o event loop volta a girar normalmente. Sem isto, um bug no
    // próprio teste (macrotask que nunca é agendada) faria a asserção acima passar à toa.
    await new Promise((resolve) => setImmediate(resolve))
    expect(macrotaskRodou, 'a macrotask externa nunca rodou — o teste não está medindo nada').toBe(
      true,
    )
  })
})
