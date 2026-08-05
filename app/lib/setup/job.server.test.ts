import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db.server'
import { LEASE_ORFAO_MS, MAX_ATTEMPTS } from './job'
import {
  type ArtefatosDoJob,
  claimNextSetupJob,
  contarFilaDeSetup,
  failSetupJob,
  finalizarJobComSucesso,
  heartbeatSetupJob,
  startSetupJobSweeper,
  varrerJobs,
} from './job.server'

// Integração com o banco de teste. O claim atômico, o lease e a transação final dependem
// do comportamento REAL do `updateMany` condicional e do rollback — mockar o banco aqui
// provaria a forma da query, não a garantia. As decisões puras (backoff, taxonomia,
// códigos de erro) estão em job.test.ts.

let tenantId: string
let tenantSlug: string
let setupId: string
let versionId: string

const ARTEFATOS: ArtefatosDoJob = {
  candidateConfigJson: '{"nome":"Clínica"}',
  candidateKnowledgeJson: '[{"titulo":"FAQ"}]',
  summaryJson: '{"resumo":"ok"}',
  gapsJson: '[]',
  risksJson: '[]',
  validationJson: '[{"id":"q1"}]',
}

/** Cria um job pronto para ser reivindicado. */
async function criarJob(
  dados: Partial<{
    status: string
    attempts: number
    nextAttemptAt: Date
    generation: number
  }> = {},
) {
  return db.aiSetupJob.create({
    data: {
      versionId,
      tenantId,
      kind: 'generate',
      generation: dados.generation ?? 1,
      idempotencyKey: `${versionId}:${crypto.randomUUID()}`,
      status: dados.status ?? 'pending',
      attempts: dados.attempts ?? 0,
      ...(dados.nextAttemptAt ? { nextAttemptAt: dados.nextAttemptAt } : {}),
    },
  })
}

/** Reivindica e devolve o snapshot, falhando alto se não vier nada. */
async function reivindicar() {
  const pego = await claimNextSetupJob()
  if (!pego) {
    throw new Error('esperava um job na fila')
  }
  return pego
}

beforeEach(async () => {
  // A fila é GLOBAL — `claimNextSetupJob` não filtra por tenant, e é assim que tem que
  // ser: existe uma fila só. Sem limpar, um teste reivindicava o job do teste anterior.
  await db.aiSetupJob.deleteMany({})

  tenantSlug = `job-${crypto.randomUUID().slice(0, 8)}`
  const tenant = await db.tenant.create({ data: { slug: tenantSlug, name: 'Tenant de teste' } })
  tenantId = tenant.id
  setupId = (await db.aiSetup.create({ data: { tenantId } })).id
  versionId = (
    await db.aiSetupVersion.create({
      data: {
        setupId,
        tenantId,
        state: 'submitted',
        generation: 1,
        answersJson: JSON.stringify({ nome: 'Clínica Bem Estar', horario: '9h às 18h' }),
      },
    })
  ).id
})

describe('claim: snapshot imutável (spec §6.1)', () => {
  it('devolve tenantSlug e as respostas — quem processa não volta ao banco', async () => {
    // O contrato do job é um snapshot: reler `answersJson` depois do claim faria a geração
    // usar uma edição que chegou no meio, e a revisão interna aprovaria uma coisa enquanto
    // se publica outra.
    const job = await criarJob()

    const pego = await reivindicar()

    expect(pego.id).toBe(job.id)
    expect(pego.tenantSlug).toBe(tenantSlug)
    expect(pego.answers).toEqual({ nome: 'Clínica Bem Estar', horario: '9h às 18h' })
    expect(pego.generation).toBe(1)
    expect(pego.attempts).toBe(1)
    expect(pego.claimToken).toBeTruthy()
  })

  it('o snapshot NÃO muda quando as respostas mudam depois', async () => {
    await criarJob()
    const pego = await reivindicar()

    await db.aiSetupVersion.update({
      where: { id: versionId },
      data: { answersJson: JSON.stringify({ nome: 'OUTRO NOME' }) },
    })

    // O snapshot é um valor, não uma vista do banco.
    expect(pego.answers.nome).toBe('Clínica Bem Estar')
  })

  it('registra job_started na MESMA transação do claim', async () => {
    const job = await criarJob()
    const pego = await reivindicar()

    const evento = await db.aiSetupEvent.findFirst({
      where: { tenantId, versionId, kind: 'job_started' },
    })
    expect(evento?.actor).toBe('job')
    expect(evento?.detail).toContain(job.id)
    expect(pego.attempts).toBe(1)
  })

  it('job apontando versão de outro tenant sai da fila como terminal', async () => {
    // Não dá para montar snapshot e não adianta re-tentar.
    const outro = await db.tenant.create({
      data: { slug: `outro-${crypto.randomUUID().slice(0, 8)}`, name: 'Outro' },
    })
    const outroSetup = await db.aiSetup.create({ data: { tenantId: outro.id } })
    const alheia = await db.aiSetupVersion.create({
      data: { setupId: outroSetup.id, tenantId: outro.id, state: 'submitted', answersJson: '{}' },
    })
    const quebrado = await db.aiSetupJob.create({
      data: {
        versionId: alheia.id,
        tenantId, // ← tenant errado para essa versão
        kind: 'generate',
        generation: 1,
        idempotencyKey: `quebrado:${crypto.randomUUID()}`,
      },
    })

    expect(await claimNextSetupJob()).toBeNull()

    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: quebrado.id } })
    expect(depois.status).toBe('failed')
    expect(depois.failureKind).toBe('terminal')
  })

  it('job quebrado não impede o SEGUINTE de ser pego', async () => {
    const outro = await db.tenant.create({
      data: { slug: `outro-${crypto.randomUUID().slice(0, 8)}`, name: 'Outro' },
    })
    const outroSetup = await db.aiSetup.create({ data: { tenantId: outro.id } })
    const alheia = await db.aiSetupVersion.create({
      data: { setupId: outroSetup.id, tenantId: outro.id, state: 'submitted', answersJson: '{}' },
    })
    await db.aiSetupJob.create({
      data: {
        versionId: alheia.id,
        tenantId,
        kind: 'generate',
        generation: 1,
        idempotencyKey: `quebrado:${crypto.randomUUID()}`,
        nextAttemptAt: new Date(Date.now() - 120_000), // vem primeiro na fila
      },
    })
    const bom = await criarJob({ nextAttemptAt: new Date(Date.now() - 60_000) })

    expect((await claimNextSetupJob())?.id).toBe(bom.id)
  })
})

describe('claim atômico', () => {
  it('DOIS claims concorrentes não levam o mesmo job', async () => {
    // É a garantia inteira da fila: dois processos assistidos rodando junto gerariam a
    // MESMA configuração duas vezes.
    await criarJob()

    const [a, b] = await Promise.all([claimNextSetupJob(), claimNextSetupJob()])

    expect([a, b].filter(Boolean)).toHaveLength(1)
  })

  it('com DOIS jobs na fila, dois claims concorrentes levam UM CADA', async () => {
    // Quem perde a corrida pelo primeiro não pode voltar de mãos vazias com a fila cheia.
    await criarJob({ nextAttemptAt: new Date(Date.now() - 120_000) })
    await criarJob({ nextAttemptAt: new Date(Date.now() - 60_000) })

    const [a, b] = await Promise.all([claimNextSetupJob(), claimNextSetupJob()])

    expect([a, b].filter(Boolean)).toHaveLength(2)
    expect(a?.id).not.toBe(b?.id)
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

  it('empate no relógio é desempatado, não sorteado', async () => {
    // `nextAttemptAt` tem default `now()`: dois jobs criados juntos empatam de verdade.
    // Sem desempate estável, um deles podia ficar para trás indefinidamente.
    const mesmoInstante = new Date(Date.now() - 60_000)
    const primeiro = await criarJob({ nextAttemptAt: mesmoInstante })
    const segundo = await criarJob({ nextAttemptAt: mesmoInstante })

    const a = await reivindicar()
    const b = await reivindicar()

    expect(new Set([a.id, b.id])).toEqual(new Set([primeiro.id, segundo.id]))
  })

  it('o claim incrementa attempts — crash no meio conta como tentativa', async () => {
    const job = await criarJob()
    await reivindicar()
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.attempts).toBe(1)
    expect(depois.status).toBe('processing')
  })

  it('startedAt guarda o começo do trabalho, não da tentativa', async () => {
    const job = await criarJob()
    const primeiro = await reivindicar()
    const inicio = (await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).startedAt

    await failSetupJob({
      jobId: job.id,
      claimToken: primeiro.claimToken,
      tenantId,
      versionId,
      kind: 'transient',
      codigo: 'provider_timeout',
    })
    // Simula a varredura devolvendo o job depois que a espera do backoff venceu.
    await db.aiSetupJob.update({
      where: { id: job.id },
      data: { status: 'pending', nextAttemptAt: new Date(Date.now() - 1000) },
    })
    await reivindicar()

    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.startedAt?.getTime()).toBe(inicio?.getTime())
  })
})

describe('lease: sem o token não se escreve', () => {
  it('heartbeat renova com o token certo', async () => {
    const job = await criarJob()
    const pego = await reivindicar()
    const antes = (await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).claimedAt

    await new Promise((r) => setTimeout(r, 5))
    expect(await heartbeatSetupJob(job.id, pego.claimToken)).toBe(true)

    const depois = (await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).claimedAt
    expect(depois?.getTime()).toBeGreaterThan(antes?.getTime() ?? 0)
  })

  it('heartbeat com token ERRADO não renova', async () => {
    // O processo que ficou pendurado precisa descobrir que perdeu o job — senão ele
    // termina e sobrescreve o trabalho de quem herdou.
    const job = await criarJob()
    await reivindicar()
    expect(await heartbeatSetupJob(job.id, 'token-de-outro')).toBe(false)
  })

  it('falha com token errado não escreve nada', async () => {
    const job = await criarJob()
    await reivindicar()

    const resultado = await failSetupJob({
      jobId: job.id,
      claimToken: 'token-de-outro',
      tenantId,
      versionId,
      kind: 'terminal',
      codigo: 'validacao_reprovou',
    })

    expect(resultado).toBeNull()
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('processing') // intacto
    expect(depois.lastError).toBeNull()
  })
})

describe('transação final: artefatos, versão, job e evento juntos', () => {
  it('grava tudo de uma vez', async () => {
    const job = await criarJob()
    const pego = await reivindicar()

    const resultado = await finalizarJobComSucesso({
      jobId: job.id,
      claimToken: pego.claimToken,
      versionId,
      tenantId,
      generation: 1,
      artefatos: ARTEFATOS,
      proximoEstado: null,
    })

    expect(resultado).toEqual({ ok: true })

    const versao = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(versao.candidateConfigJson).toBe(ARTEFATOS.candidateConfigJson)
    expect(versao.validationJson).toBe(ARTEFATOS.validationJson)
    expect(versao.state).toBe('submitted') // sem lacunas, o estado não muda

    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('completed')
    expect(depois.claimToken).toBeNull()

    const evento = await db.aiSetupEvent.findFirst({ where: { versionId, kind: 'job_completed' } })
    expect(evento?.actor).toBe('job')
  })

  it('lacunas de negócio levam a versão para needs_changes (§6.4)', async () => {
    // Lacuna não é falha do job: ele fez o trabalho e a conclusão é "faltou informação".
    const job = await criarJob()
    const pego = await reivindicar()

    await finalizarJobComSucesso({
      jobId: job.id,
      claimToken: pego.claimToken,
      versionId,
      tenantId,
      generation: 1,
      artefatos: { ...ARTEFATOS, gapsJson: '[{"campo":"horario"}]' },
      proximoEstado: 'needs_changes',
    })

    const versao = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(versao.state).toBe('needs_changes')
    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'completed',
    )
  })

  it('lease perdido: NADA é escrito, nem os artefatos', async () => {
    // O ponto da transação única: gravar artefato e falhar ao concluir deixaria o job
    // voltando à fila para gerar de novo por cima do que já estava lá.
    const job = await criarJob()
    await reivindicar()

    const resultado = await finalizarJobComSucesso({
      jobId: job.id,
      claimToken: 'token-de-outro',
      versionId,
      tenantId,
      generation: 1,
      artefatos: ARTEFATOS,
      proximoEstado: null,
    })

    expect(resultado).toEqual({ ok: false, motivo: 'lease_perdido' })
    const versao = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(versao.candidateConfigJson).toBeNull()
    expect(await db.aiSetupEvent.count({ where: { versionId, kind: 'job_completed' } })).toBe(0)
  })

  it('geração mudou embaixo: nada é escrito e o job continua nosso', async () => {
    // O cliente reabriu e submeteu de novo enquanto este job rodava (§4.8). A candidata
    // nova não pode ser sobrescrita pela antiga.
    const job = await criarJob()
    const pego = await reivindicar()
    await db.aiSetupVersion.update({ where: { id: versionId }, data: { generation: 2 } })

    const resultado = await finalizarJobComSucesso({
      jobId: job.id,
      claimToken: pego.claimToken,
      versionId,
      tenantId,
      generation: 1,
      artefatos: ARTEFATOS,
      proximoEstado: null,
    })

    expect(resultado).toEqual({ ok: false, motivo: 'versao_mudou' })
    const versao = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(versao.candidateConfigJson).toBeNull()
    // O job segue em processing: quem chamou decide marcar como obsoleto.
    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'processing',
    )
  })

  it('versão que saiu de submitted também barra a escrita', async () => {
    const job = await criarJob()
    const pego = await reivindicar()
    await db.aiSetupVersion.update({ where: { id: versionId }, data: { state: 'needs_changes' } })

    const resultado = await finalizarJobComSucesso({
      jobId: job.id,
      claimToken: pego.claimToken,
      versionId,
      tenantId,
      generation: 1,
      artefatos: ARTEFATOS,
      proximoEstado: null,
    })

    expect(resultado).toEqual({ ok: false, motivo: 'versao_mudou' })
  })

  it('depois de finalizar, o token não vale mais', async () => {
    const job = await criarJob()
    const pego = await reivindicar()
    await finalizarJobComSucesso({
      jobId: job.id,
      claimToken: pego.claimToken,
      versionId,
      tenantId,
      generation: 1,
      artefatos: ARTEFATOS,
      proximoEstado: null,
    })

    expect(await heartbeatSetupJob(job.id, pego.claimToken)).toBe(false)
  })
})

describe('falha: destino, código e evento', () => {
  it('transitória agenda a volta e devolve o lease', async () => {
    const job = await criarJob()
    const pego = await reivindicar()

    const resultado = await failSetupJob({
      jobId: job.id,
      claimToken: pego.claimToken,
      tenantId,
      versionId,
      kind: 'transient',
      codigo: 'provider_indisponivel',
      detalhe: new Error('spawn claude ENOENT'),
    })

    expect(resultado?.status).toBe('retry_wait')
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('retry_wait')
    expect(depois.failureKind).toBe('transient')
    expect(depois.claimToken).toBeNull()
    expect(depois.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('lastError guarda o CÓDIGO, nunca a mensagem', async () => {
    // Sanitizar texto livre é corrida que se perde: o erro de um job de agentes carrega
    // pedaço do prompt e da saída, ou seja, as respostas da empresa.
    const job = await criarJob()
    const pego = await reivindicar()

    await failSetupJob({
      jobId: job.id,
      claimToken: pego.claimToken,
      tenantId,
      versionId,
      kind: 'invalid_output',
      codigo: 'saida_invalida',
      detalhe: new Error('JSON inválido: {"empresa":"Clínica X","cliente":"João"}'),
    })

    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.lastError).toBe('saida_invalida')
    expect(depois.lastError).not.toContain('Clínica')
    expect(depois.lastError).not.toContain('João')
  })

  it('registra job_failed com o código e a tentativa', async () => {
    const job = await criarJob()
    const pego = await reivindicar()

    await failSetupJob({
      jobId: job.id,
      claimToken: pego.claimToken,
      tenantId,
      versionId,
      kind: 'terminal',
      codigo: 'validacao_reprovou',
      detalhe: new Error('a Clínica X reprovou'),
    })

    const evento = await db.aiSetupEvent.findFirst({ where: { versionId, kind: 'job_failed' } })
    expect(evento?.actor).toBe('job')
    expect(evento?.detail).toContain('validacao_reprovou')
    // O detalhe do evento também não pode virar depósito de texto livre.
    expect(evento?.detail).not.toContain('Clínica')
  })

  it('terminal encerra na hora, sem esperar', async () => {
    const job = await criarJob()
    const pego = await reivindicar()

    const resultado = await failSetupJob({
      jobId: job.id,
      claimToken: pego.claimToken,
      tenantId,
      versionId,
      kind: 'terminal',
      codigo: 'validacao_reprovou',
    })

    expect(resultado?.status).toBe('failed')
    expect(resultado?.proximaTentativaEm).toBeNull()
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.finishedAt).not.toBeNull()
  })

  it('as tentativas vêm do BANCO, não do chamador', async () => {
    const job = await criarJob({ attempts: MAX_ATTEMPTS - 1 })
    const pego = await reivindicar() // vira MAX_ATTEMPTS

    const resultado = await failSetupJob({
      jobId: job.id,
      claimToken: pego.claimToken,
      tenantId,
      versionId,
      kind: 'transient',
      codigo: 'provider_timeout',
    })

    expect(resultado?.status).toBe('failed') // esgotou
    expect(resultado?.alarmou).toBe(true)
  })

  it('código fora da allowlist vira erro_desconhecido', async () => {
    const job = await criarJob()
    const pego = await reivindicar()

    await failSetupJob({
      jobId: job.id,
      claimToken: pego.claimToken,
      tenantId,
      versionId,
      kind: 'transient',
      // Simula dado atravessando a fronteira do tipo (o TS não protege o que vem de fora).
      codigo: 'inventado' as never,
    })

    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).lastError).toBe(
      'erro_desconhecido',
    )
  })
})

describe('as faxinas', () => {
  it('órfão volta para a fila sem token', async () => {
    const job = await criarJob()
    await reivindicar()
    // Simula o dono do lease tendo sumido: heartbeat parado há tempo demais.
    await db.aiSetupJob.update({
      where: { id: job.id },
      data: { claimedAt: new Date(Date.now() - LEASE_ORFAO_MS - 1000) },
    })

    expect((await varrerJobs()).orfaos).toBe(1)
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('pending')
    expect(depois.claimToken).toBeNull()
  })

  it('job que ainda bate heartbeat NÃO é considerado órfão', async () => {
    // Um limite curto devolveria à fila um job que está trabalhando, e aí dois processos
    // gerariam a mesma configuração.
    const job = await criarJob()
    await reivindicar()

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
    await reivindicar() // vira MAX_ATTEMPTS, status processing
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
    await criarJob()
    await criarJob({ status: 'retry_wait', attempts: 1 })
    await criarJob({ status: 'failed', attempts: MAX_ATTEMPTS })
    await criarJob()
    await reivindicar()

    const contagem = await contarFilaDeSetup()

    expect(contagem.processando).toBe(1)
    expect(contagem.esperando).toBe(1)
    expect(contagem.falhos).toBe(1)
    expect(contagem.pendentes).toBe(1)
  })
})
