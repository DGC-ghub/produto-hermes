import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db.server'
import { LEASE_ORFAO_MS, MAX_ATTEMPTS } from './job'
import {
  claimNextSetupJob,
  completeSetupJob,
  contarFilaDeSetup,
  failSetupJob,
  heartbeatSetupJob,
  startSetupJobSweeper,
  varrerJobs,
} from './job.server'

// Integração com o banco de teste. O claim atômico e o lease dependem do comportamento
// REAL do `updateMany` condicional — mockar o banco aqui provaria a forma da query, não a
// garantia. As decisões puras (backoff, taxonomia) estão em job.test.ts.

let tenantId: string
let setupId: string
let versionId: string

/** Cria um job pronto para ser reivindicado. */
async function criarJob(
  dados: Partial<{ status: string; attempts: number; nextAttemptAt: Date }> = {},
) {
  return db.aiSetupJob.create({
    data: {
      versionId,
      tenantId,
      kind: 'generate',
      generation: 1,
      idempotencyKey: `${versionId}:${crypto.randomUUID()}`,
      status: dados.status ?? 'pending',
      attempts: dados.attempts ?? 0,
      ...(dados.nextAttemptAt ? { nextAttemptAt: dados.nextAttemptAt } : {}),
    },
  })
}

beforeEach(async () => {
  // A fila é GLOBAL — `claimNextSetupJob` não filtra por tenant, e é assim que tem que
  // ser: existe uma fila só. Sem limpar, um teste reivindicava o job do teste anterior.
  await db.aiSetupJob.deleteMany({})

  const tenant = await db.tenant.create({
    data: { slug: `job-${crypto.randomUUID().slice(0, 8)}`, name: 'Tenant de teste' },
  })
  tenantId = tenant.id
  setupId = (await db.aiSetup.create({ data: { tenantId } })).id
  versionId = (
    await db.aiSetupVersion.create({
      data: { setupId, tenantId, state: 'submitted', answersJson: '{}', generation: 1 },
    })
  ).id
})

describe('claim atômico', () => {
  it('pega o job e devolve o snapshot com o token do lease', async () => {
    const job = await criarJob()

    const pego = await claimNextSetupJob()

    expect(pego?.id).toBe(job.id)
    expect(pego?.versionId).toBe(versionId)
    expect(pego?.generation).toBe(1)
    expect(pego?.attempts).toBe(1) // já contando esta tentativa
    expect(pego?.claimToken).toBeTruthy()
  })

  it('DOIS claims concorrentes não levam o mesmo job', async () => {
    // É a garantia inteira da fila: dois processos assistidos rodando junto (ou um sweeper
    // e um comando) gerariam a MESMA configuração duas vezes.
    await criarJob()

    const [a, b] = await Promise.all([claimNextSetupJob(), claimNextSetupJob()])

    const pegos = [a, b].filter(Boolean)
    expect(pegos).toHaveLength(1)
  })

  it('não pega job que ainda está esperando o backoff', async () => {
    await criarJob({ status: 'pending', nextAttemptAt: new Date(Date.now() + 60_000) })
    expect(await claimNextSetupJob()).toBeNull()
  })

  it('não pega job sem tentativa sobrando', async () => {
    await criarJob({ attempts: MAX_ATTEMPTS })
    expect(await claimNextSetupJob()).toBeNull()
  })

  it.each([
    ['processing'],
    ['retry_wait'],
    ['failed'],
    ['completed'],
  ])('não pega job em %s', async (status) => {
    await criarJob({ status })
    expect(await claimNextSetupJob()).toBeNull()
  })

  it('FIFO: o mais antigo elegível vem primeiro', async () => {
    const antigo = await criarJob({ nextAttemptAt: new Date(Date.now() - 120_000) })
    await criarJob({ nextAttemptAt: new Date(Date.now() - 60_000) })

    expect((await claimNextSetupJob())?.id).toBe(antigo.id)
  })

  it('o claim incrementa attempts — crash no meio conta como tentativa', async () => {
    // Sem contar, um job que derruba o processo seria reivindicado para sempre.
    const job = await criarJob()
    await claimNextSetupJob()
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.attempts).toBe(1)
    expect(depois.status).toBe('processing')
  })

  it('startedAt guarda o começo do trabalho, não da tentativa', async () => {
    const job = await criarJob()
    const primeiro = await claimNextSetupJob()
    const inicio = (await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).startedAt

    await failSetupJob(job.id, primeiro?.claimToken ?? '', 'transient', new Error('x'))
    await db.aiSetupJob.update({ where: { id: job.id }, data: { status: 'pending' } })
    await claimNextSetupJob()

    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.startedAt?.getTime()).toBe(inicio?.getTime())
  })
})

describe('lease: sem o token não se escreve', () => {
  it('heartbeat renova com o token certo', async () => {
    const job = await criarJob()
    const pego = await claimNextSetupJob()
    const antes = (await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).claimedAt

    await new Promise((r) => setTimeout(r, 5))
    expect(await heartbeatSetupJob(job.id, pego?.claimToken ?? '')).toBe(true)

    const depois = (await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).claimedAt
    expect(depois?.getTime()).toBeGreaterThan(antes?.getTime() ?? 0)
  })

  it('heartbeat com token ERRADO não renova', async () => {
    // O processo que ficou pendurado precisa descobrir que perdeu o job — senão ele
    // termina e sobrescreve o trabalho de quem herdou.
    const job = await criarJob()
    await claimNextSetupJob()
    expect(await heartbeatSetupJob(job.id, 'token-de-outro')).toBe(false)
  })

  it('conclusão exige o token', async () => {
    const job = await criarJob()
    const pego = await claimNextSetupJob()

    expect(await completeSetupJob(job.id, 'token-de-outro')).toBe(false)
    expect(await completeSetupJob(job.id, pego?.claimToken ?? '')).toBe(true)

    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('completed')
    expect(depois.finishedAt).not.toBeNull()
  })

  it('falha com token errado não escreve nada', async () => {
    const job = await criarJob()
    await claimNextSetupJob()

    expect(await failSetupJob(job.id, 'token-de-outro', 'terminal', new Error('x'))).toBeNull()

    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('processing') // intacto
    expect(depois.lastError).toBeNull()
  })

  it('depois de concluir, o token não vale mais', async () => {
    const job = await criarJob()
    const pego = await claimNextSetupJob()
    await completeSetupJob(job.id, pego?.claimToken ?? '')

    expect(await heartbeatSetupJob(job.id, pego?.claimToken ?? '')).toBe(false)
  })
})

describe('falha: destino e backoff', () => {
  it('transitória agenda a volta e devolve o lease', async () => {
    const job = await criarJob()
    const pego = await claimNextSetupJob()

    const resultado = await failSetupJob(
      job.id,
      pego?.claimToken ?? '',
      'transient',
      new Error('provider caiu'),
    )

    expect(resultado?.status).toBe('retry_wait')
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('retry_wait')
    expect(depois.failureKind).toBe('transient')
    expect(depois.lastError).toBe('provider caiu')
    // O lease morre com a tentativa: quem re-tentar ganha um token novo.
    expect(depois.claimToken).toBeNull()
    expect(depois.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('terminal encerra na hora, sem esperar', async () => {
    const job = await criarJob()
    const pego = await claimNextSetupJob()

    const resultado = await failSetupJob(
      job.id,
      pego?.claimToken ?? '',
      'terminal',
      new Error('validação reprovou'),
    )

    expect(resultado?.status).toBe('failed')
    expect(resultado?.proximaTentativaEm).toBeNull()
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('failed')
    expect(depois.finishedAt).not.toBeNull()
  })

  it('as tentativas vêm do BANCO, não do chamador', async () => {
    // Quem processa pode estar com um número velho na mão; decidir "esgotou" com ele
    // marcaria como definitivo um job que ainda tinha chance.
    const job = await criarJob({ attempts: MAX_ATTEMPTS - 1 })
    const pego = await claimNextSetupJob() // vira MAX_ATTEMPTS

    const resultado = await failSetupJob(
      job.id,
      pego?.claimToken ?? '',
      'transient',
      new Error('x'),
    )

    expect(resultado?.status).toBe('failed') // esgotou
    expect(resultado?.alarmou).toBe(true)
  })

  it('o erro guardado é sanitizado', async () => {
    const job = await criarJob()
    const pego = await claimNextSetupJob()

    await failSetupJob(
      job.id,
      pego?.claimToken ?? '',
      'invalid_output',
      new Error('JSON inválido\n{"empresa":"Clínica X"}'),
    )

    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    // A segunda linha traz resposta da empresa: não entra no banco de fila.
    expect(depois.lastError).toBe('JSON inválido')
  })
})

describe('as faxinas', () => {
  it('órfão volta para a fila sem token', async () => {
    const job = await criarJob()
    await claimNextSetupJob()
    // Simula o dono do lease tendo sumido: heartbeat parado há tempo demais.
    await db.aiSetupJob.update({
      where: { id: job.id },
      data: { claimedAt: new Date(Date.now() - LEASE_ORFAO_MS - 1000) },
    })

    const resultado = await varrerJobs()

    expect(resultado.orfaos).toBe(1)
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('pending')
    expect(depois.claimToken).toBeNull()
  })

  it('job que ainda bate heartbeat NÃO é considerado órfão', async () => {
    // Um limite curto devolveria à fila um job que está trabalhando, e aí dois processos
    // gerariam a mesma configuração.
    const job = await criarJob()
    await claimNextSetupJob()

    expect((await varrerJobs()).orfaos).toBe(0)
    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'processing',
    )
  })

  it('espera cumprida devolve o job para pending', async () => {
    const job = await criarJob({
      status: 'retry_wait',
      attempts: 1,
      nextAttemptAt: new Date(Date.now() - 1000),
    })

    expect((await varrerJobs()).liberados).toBe(1)
    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'pending',
    )
  })

  it('espera NÃO cumprida deixa o job quieto', async () => {
    const job = await criarJob({
      status: 'retry_wait',
      attempts: 1,
      nextAttemptAt: new Date(Date.now() + 60_000),
    })

    expect((await varrerJobs()).liberados).toBe(0)
    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'retry_wait',
    )
  })

  it('zumbi (pending sem tentativa sobrando) vira failed', async () => {
    // Acontece quando o processo morre DENTRO da última tentativa: ninguém marcou como
    // falho e o job ficava invisível para o claim, sem nunca ser alarmado.
    const job = await criarJob({ status: 'pending', attempts: MAX_ATTEMPTS })

    expect((await varrerJobs()).esgotados).toBe(1)
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('failed')
    expect(depois.finishedAt).not.toBeNull()
  })

  it('a varredura devolve o órfão E o marca esgotado na mesma passada', async () => {
    // A ordem importa: se o zumbi fosse varrido antes do órfão, um órfão sem tentativas
    // sobrando ficaria em `pending` até a passada seguinte.
    const job = await criarJob({ attempts: MAX_ATTEMPTS - 1 })
    await claimNextSetupJob() // vira MAX_ATTEMPTS, status processing
    await db.aiSetupJob.update({
      where: { id: job.id },
      data: { claimedAt: new Date(Date.now() - LEASE_ORFAO_MS - 1000) },
    })

    const resultado = await varrerJobs()

    expect(resultado.orfaos).toBe(1)
    expect(resultado.esgotados).toBe(1)
    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('failed')
  })

  it('a varredura NÃO reivindica nada', async () => {
    // Reivindicar aqui seria ligar o worker automático pela porta dos fundos.
    const job = await criarJob()
    await varrerJobs()
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('pending')
    expect(depois.attempts).toBe(0)
    expect(depois.claimToken).toBeNull()
  })
})

describe('sweeper', () => {
  it('é idempotente e não segura o processo aberto', () => {
    // Dois timers seria o HMR do dev empilhando varredura; um timer com ref seguraria o
    // vitest (e o processo) abertos para sempre.
    startSetupJobSweeper()
    const primeiro = globalThis.__hermesSetupJobSweeper
    startSetupJobSweeper()

    expect(globalThis.__hermesSetupJobSweeper).toBe(primeiro)
    expect(primeiro?.hasRef()).toBe(false)

    clearInterval(primeiro)
    globalThis.__hermesSetupJobSweeper = undefined
  })
})

describe('contagem da fila', () => {
  it('separa por situação', async () => {
    await criarJob() // pendente elegível
    await criarJob({ status: 'retry_wait', attempts: 1 })
    await criarJob({ status: 'failed', attempts: MAX_ATTEMPTS })
    const emCurso = await criarJob()
    await claimNextSetupJob()

    const contagem = await contarFilaDeSetup()

    expect(contagem.processando).toBe(1)
    expect(contagem.esperando).toBe(1)
    expect(contagem.falhos).toBe(1)
    expect(emCurso.id).toBeTruthy()
  })
})
