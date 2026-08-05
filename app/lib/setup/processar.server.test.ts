import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db.server'
import { MAX_ATTEMPTS } from './job'
import type { ArtefatosDoJob, JobReivindicado } from './job.server'
import { FalhaDoProcessamento, type Processador, processarProximoJob } from './processar.server'

// A orquestração testada com processador FALSO — que é o ponto de ele ser injetado. Dá
// para exercitar sucesso, lacuna de negócio, cada tipo de falha e a perda do lease sem
// chamar o cérebro (minutos por job, concorrência 1).

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

/** Processador que sempre dá certo. Registra o que recebeu. */
function processadorOk(vistos: JobReivindicado[] = [], temLacunas = false): Processador {
  return async (job) => {
    vistos.push(job)
    return { artefatos: ARTEFATOS, temLacunas }
  }
}

async function respostasCompletas(): Promise<Record<string, string | string[]>> {
  const { SETUP_FIELDS } = await import('./answers')
  const answers: Record<string, string | string[]> = {}
  for (const field of SETUP_FIELDS) {
    answers[field.key] =
      field.kind === 'list' ? ['um item bem descritivo'] : 'resposta com folga acima do mínimo'
  }
  return answers
}

/** Cria um job pronto para ser reivindicado. */
async function criarJob(attempts = 0) {
  return db.aiSetupJob.create({
    data: {
      versionId,
      tenantId,
      kind: 'generate',
      generation: 1,
      idempotencyKey: `${versionId}:${crypto.randomUUID()}`,
      attempts,
    },
  })
}

/** Sem heartbeat e sem espera: os testes não têm minuto para gastar. */
const SEM_ESPERA = { heartbeatMs: 0, esperaDaPersistenciaMs: 0 }

beforeEach(async () => {
  await db.aiSetupJob.deleteMany({})

  tenantSlug = `proc-${crypto.randomUUID().slice(0, 8)}`
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
        answersJson: JSON.stringify(await respostasCompletas()),
      },
    })
  ).id
  await db.aiSetup.update({ where: { id: setupId }, data: { reviewVersionId: versionId } })
})

describe('fila vazia e teto NÃO são a mesma coisa', () => {
  it('sem job: nada_a_fazer', async () => {
    const resultado = await processarProximoJob({ processador: processadorOk(), ...SEM_ESPERA })
    expect(resultado).toEqual({ tipo: 'nada_a_fazer' })
  })

  it('teto de candidatos: teto_atingido, e o processador nem é chamado', async () => {
    // 51 jobs que o claim recusa. Reportar "nada_a_fazer" aqui mandaria a pessoa embora
    // com a fila cheia.
    await db.aiSetup.update({ where: { id: setupId }, data: { reviewVersionId: null } })
    for (let i = 0; i < 51; i += 1) {
      await criarJob()
    }
    const vistos: JobReivindicado[] = []

    const resultado = await processarProximoJob({
      processador: processadorOk(vistos),
      ...SEM_ESPERA,
    })

    expect(resultado.tipo).toBe('teto_atingido')
    expect(vistos).toHaveLength(0)
  })
})

describe('caminho feliz', () => {
  it('processa e grava os artefatos', async () => {
    const job = await criarJob()
    const vistos: JobReivindicado[] = []

    const resultado = await processarProximoJob({
      processador: processadorOk(vistos),
      ...SEM_ESPERA,
    })

    expect(resultado).toEqual({
      tipo: 'concluido',
      jobId: job.id,
      versionId,
      tenantSlug,
      comLacunas: false,
    })

    const versao = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(versao.candidateConfigJson).toBe(ARTEFATOS.candidateConfigJson)
    expect(versao.state).toBe('submitted')
    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'completed',
    )
  })

  it('o processador recebe o snapshot, não um id para ir buscar', async () => {
    // É o contrato do §6.1: quem gera não volta ao banco.
    await criarJob()
    const vistos: JobReivindicado[] = []

    await processarProximoJob({ processador: processadorOk(vistos), ...SEM_ESPERA })

    expect(vistos).toHaveLength(1)
    expect(vistos[0].tenantSlug).toBe(tenantSlug)
    expect(vistos[0].answers.nome).toBeTruthy()
    expect(vistos[0].claimToken).toBeTruthy()
  })

  it('lacuna de negócio: job completed e versão em needs_changes', async () => {
    // Lacuna não é falha: o job fez o trabalho e a conclusão é "faltou informação".
    const job = await criarJob()

    const resultado = await processarProximoJob({
      processador: processadorOk([], true),
      ...SEM_ESPERA,
    })

    expect(resultado.tipo).toBe('concluido')
    expect((await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })).state).toBe(
      'needs_changes',
    )
    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'completed',
    )
  })
})

describe('falhas do processador', () => {
  it('falha classificada vira o desfecho que ela pede', async () => {
    const job = await criarJob()

    const resultado = await processarProximoJob({
      processador: async () => {
        throw new FalhaDoProcessamento('invalid_output', 'saida_invalida')
      },
      ...SEM_ESPERA,
    })

    expect(resultado).toMatchObject({
      tipo: 'falhou',
      kind: 'invalid_output',
      codigo: 'saida_invalida',
      status: 'retry_wait',
    })
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('retry_wait')
    expect(depois.lastError).toBe('saida_invalida')
  })

  it('erro NÃO classificado é tratado como transitório', async () => {
    // Errar para o lado de tentar de novo é mais barato: job morto precisa de trabalho
    // manual para reviver, e o teto de três tentativas limita o custo de insistir.
    const job = await criarJob()

    const resultado = await processarProximoJob({
      processador: async () => {
        throw new TypeError('x is not a function')
      },
      ...SEM_ESPERA,
    })

    expect(resultado).toMatchObject({ tipo: 'falhou', kind: 'transient', status: 'retry_wait' })
    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).lastError).toBe(
      'erro_desconhecido',
    )
  })

  it('falha terminal encerra o job na hora', async () => {
    const job = await criarJob()

    const resultado = await processarProximoJob({
      processador: async () => {
        throw new FalhaDoProcessamento('terminal', 'validacao_reprovou')
      },
      ...SEM_ESPERA,
    })

    expect(resultado).toMatchObject({ tipo: 'falhou', status: 'failed' })
    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('failed')
  })

  it('na última tentativa, a falha transitória encerra', async () => {
    const job = await criarJob(MAX_ATTEMPTS - 1)

    const resultado = await processarProximoJob({
      processador: async () => {
        throw new FalhaDoProcessamento('transient', 'provider_timeout')
      },
      ...SEM_ESPERA,
    })

    expect(resultado).toMatchObject({ tipo: 'falhou', status: 'failed' })
    expect((await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('failed')
  })

  it('falha NÃO grava artefato nenhum', async () => {
    await criarJob()

    await processarProximoJob({
      processador: async () => {
        throw new FalhaDoProcessamento('transient', 'provider_indisponivel')
      },
      ...SEM_ESPERA,
    })

    const versao = await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })
    expect(versao.candidateConfigJson).toBeNull()
    expect(versao.state).toBe('submitted')
  })
})

describe('o estado mudou embaixo enquanto o processador trabalhava', () => {
  it('geração nova: recusado, sem escrever', async () => {
    // O cliente reabriu e submeteu de novo (§4.8). A candidata antiga não pode entrar.
    const job = await criarJob()

    const resultado = await processarProximoJob({
      processador: async () => {
        // "Durante" o trabalho: é a janela real, que dura minutos em produção.
        await db.aiSetupVersion.update({ where: { id: versionId }, data: { generation: 2 } })
        return { artefatos: ARTEFATOS, temLacunas: false }
      },
      ...SEM_ESPERA,
    })

    expect(resultado).toEqual({ tipo: 'recusado', jobId: job.id, motivo: 'versao_mudou' })
    expect(
      (await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })).candidateConfigJson,
    ).toBeNull()
  })

  it('lease tomado por outro: recusado, sem escrever', async () => {
    const job = await criarJob()

    const resultado = await processarProximoJob({
      processador: async () => {
        // Simula o órfão sendo devolvido e reivindicado por outro processo.
        await db.aiSetupJob.update({
          where: { id: job.id },
          data: { status: 'processing', claimToken: 'token-de-outro' },
        })
        return { artefatos: ARTEFATOS, temLacunas: false }
      },
      ...SEM_ESPERA,
    })

    expect(resultado).toEqual({ tipo: 'recusado', jobId: job.id, motivo: 'lease_perdido' })
    expect(
      (await db.aiSetupVersion.findUniqueOrThrow({ where: { id: versionId } })).candidateConfigJson,
    ).toBeNull()
  })

  it('recusa não é repetida: insistir daria o mesmo resultado', async () => {
    // Diferente de erro de banco. Se a recusa entrasse no laço de persistência, o comando
    // gastaria as três tentativas para chegar à mesma conclusão.
    await criarJob()
    let vezesQueGerou = 0

    const resultado = await processarProximoJob({
      processador: async () => {
        vezesQueGerou += 1
        await db.aiSetupVersion.update({ where: { id: versionId }, data: { generation: 9 } })
        return { artefatos: ARTEFATOS, temLacunas: false }
      },
      ...SEM_ESPERA,
    })

    expect(resultado.tipo).toBe('recusado')
    expect(vezesQueGerou).toBe(1)
  })
})

describe('falha de gravação repete a GRAVAÇÃO, nunca a geração', () => {
  it('gravação que sempre estoura: UMA geração, lease LIBERADO e job em retry_wait', async () => {
    const job = await criarJob()
    let vezesQueGerou = 0

    const modulo = await import('./job.server')
    const espiao = vi
      .spyOn(modulo, 'finalizarJobComSucesso')
      // Contenção — é o único erro que a gravação repete.
      .mockRejectedValue(new Error('database is locked'))

    try {
      const resultado = await processarProximoJob({
        processador: async () => {
          vezesQueGerou += 1
          return { artefatos: ARTEFATOS, temLacunas: false }
        },
        ...SEM_ESPERA,
      })

      expect(resultado).toEqual({
        tipo: 'persistencia_falhou',
        jobId: job.id,
        status: 'retry_wait',
      })
      // A gravação insistiu…
      expect(espiao.mock.calls.length).toBeGreaterThan(1)
      // …e a geração aconteceu UMA vez.
      expect(vezesQueGerou).toBe(1)
    } finally {
      espiao.mockRestore()
    }

    // O ponto: o job NÃO fica preso em `processing` com o lease na mão. Deixá-lo assim
    // empurraria a recuperação para o sweeper, que só age depois de 30 minutos — fallback
    // de crash, não desfecho de uma falha que o comando VIU acontecer.
    const depois = await db.aiSetupJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(depois.status).toBe('retry_wait')
    expect(depois.claimToken).toBeNull()
    expect(depois.claimedAt).toBeNull()
    expect(depois.lastError).toBe('banco_ocupado')
    expect(depois.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('erro que NÃO é contenção não vira "banco ocupado" — ele sobe', async () => {
    // Um `catch` genérico transformava bug de lógica em três tentativas idênticas e depois
    // num desfecho que diz "banco ocupado": mentira que manda alguém investigar o lugar
    // errado.
    await criarJob()
    const modulo = await import('./job.server')
    const espiao = vi
      .spyOn(modulo, 'finalizarJobComSucesso')
      .mockRejectedValue(new TypeError('x is not a function'))

    try {
      await expect(
        processarProximoJob({
          processador: async () => ({ artefatos: ARTEFATOS, temLacunas: false }),
          ...SEM_ESPERA,
        }),
      ).rejects.toBeInstanceOf(TypeError)

      // Uma tentativa só: não se insiste no que não é contenção.
      expect(espiao.mock.calls).toHaveLength(1)
    } finally {
      espiao.mockRestore()
    }
  })
})
