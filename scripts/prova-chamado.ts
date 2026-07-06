// Prova ponta a ponta do abrir_chamado (csmed): conversa multi-turno com o cérebro
// REAL em banco DESCARTÁVEL — a confirmação do cliente tem que virar Ticket no
// banco. É a metade do pitch que nunca tinha sido comprovada (marco da 1ª quinzena
// de agosto do docs/plano-entrega-2026.md).
//
// Uso: npm run prova:chamado   (~1min — dois turnos de LLM real via claude_cli)
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'

try {
  process.loadEnvFile()
} catch {
  // sem .env — segue com o ambiente do shell
}

// Banco descartável ANTES de importar o app (o client lê DATABASE_URL no import).
// A prova nunca escreve no banco do serviço.
const SCRATCH = path.join(process.cwd(), '.prova-chamado.db')
process.env.DATABASE_URL = `file:${SCRATCH}`
execFileSync('npx', ['prisma', 'db', 'push'], { env: { ...process.env }, stdio: 'pipe' })

const { db } = await import('../app/db.server')
const { processIncomingMessage } = await import('../app/lib/conversation.server')

const CONTACT = 'prova-chamado-hospital'

try {
  console.log(
    `[prova] provider=${process.env.ATTENDANT_PROVIDER ?? 'mock'} — turno 1 (demanda B2B)…`,
  )
  const t0 = Date.now()
  const first = await processIncomingMessage({
    tenantSlug: 'csmed',
    contactId: CONTACT,
    message:
      'Boa tarde, sou a coordenadora de enfermagem do Hospital São Lucas, em Guarulhos. ' +
      'Precisamos de 2 médicos clínicos pra cobrir o plantão noturno do próximo fim de semana. ' +
      'Meu contato é (11) 98888-7777.',
  })
  console.log(`[prova] turno 1 (${Date.now() - t0}ms) needsHuman=${first.needsHuman}:`)
  console.log(`        ${first.reply}`)

  const t1 = Date.now()
  const second = await processIncomingMessage({
    tenantSlug: 'csmed',
    contactId: CONTACT,
    message: 'Sim, pode registrar por favor.',
  })
  console.log(`[prova] turno 2 (${Date.now() - t1}ms):`)
  console.log(`        ${second.reply}`)

  let tickets = await db.ticket.findMany({ where: { contactId: CONTACT } })

  // Conversa real tem 3 turnos às vezes: se o atendente pediu um detalhe antes de
  // agir, o cliente responde — e AÍ a action tem que vir.
  if (tickets.length === 0) {
    const t2 = Date.now()
    const third = await processIncomingMessage({
      tenantSlug: 'csmed',
      contactId: CONTACT,
      message: 'É para o pronto-atendimento. Pode registrar.',
    })
    console.log(`[prova] turno 3 (${Date.now() - t2}ms):`)
    console.log(`        ${third.reply}`)
    tickets = await db.ticket.findMany({ where: { contactId: CONTACT } })
  }

  if (tickets.length === 0) {
    console.error('[prova] ✗ FALHOU: nenhum Ticket no banco após a confirmação.')
    process.exitCode = 1
  } else {
    for (const ticket of tickets) {
      console.log(
        `[prova] ✓ TICKET NO BANCO: "${ticket.subject}" (categoria: ${ticket.category ?? '—'}, status: ${ticket.status})`,
      )
    }
  }
} finally {
  await db.$disconnect()
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${SCRATCH}${suffix}`, { force: true })
  }
}
