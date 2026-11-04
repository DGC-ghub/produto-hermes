import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// O comando rodando DE VERDADE, em subprocesso.
//
// Os testes de unidade cobrem cada peça, mas o que importa aqui só existe no processo
// inteiro: qual banco o `db.server` acaba usando, se o `.env` foi carregado, se um caminho
// de recusa abre conexão sem querer. Nada disso aparece chamando função.
//
// Os casos de RECUSA não tocam banco nenhum. O de `--sim` toca um banco descartável em
// /tmp, criado e destruído aqui — nunca o do serviço.

const RAIZ = path.resolve(import.meta.dirname, '..')
const SCRIPT = path.join(RAIZ, 'scripts', 'setup-processar.ts')

let tmp: string
/** Um "banco de produção" de mentira, fora do /tmp. */
let falsaProducao: string

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'hermes-cli-'))
  falsaProducao = path.join(RAIZ, `.falsa-producao-cli-${process.pid}.db`)
  writeFileSync(falsaProducao, 'não sou descartável')
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
  rmSync(falsaProducao, { force: true })
})

type Execucao = { saida: string; codigo: number }

/** Roda o comando e devolve o que ele imprimiu, sem deixar exceção vazar. */
function rodar(args: string[], databaseUrl?: string): Execucao {
  try {
    const saida = execFileSync('npx', ['tsx', SCRIPT, ...args], {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      env: {
        ...process.env,
        ...(databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl }),
        // O worker do vitest exporta isto; o subprocesso precisa se comportar como um
        // comando de verdade, não como teste.
        VITEST: '',
      },
    })
    return { saida, codigo: 0 }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number }
    return { saida: `${e.stdout ?? ''}${e.stderr ?? ''}`, codigo: e.status ?? -1 }
  }
}

describe('recusas do comando, no processo real', () => {
  it('argumento desconhecido PARA e não cria arquivo nenhum', { timeout: 90_000 }, () => {
    const inexistente = path.join(tmp, 'nao-deve-nascer.db')

    const { saida, codigo } = rodar(['--simulacao'], `file:${inexistente}`)

    expect(codigo).not.toBe(0)
    expect(saida).toContain('Argumento desconhecido')
    // Se alguma conexão tivesse sido aberta, o SQLite teria criado o arquivo.
    expect(existsSync(inexistente)).toBe(false)
  })

  it('--falso contra banco que não existe: recusa e NÃO cria o arquivo', {
    timeout: 90_000,
  }, () => {
    // O ponto é duplo: a trava exige arquivo existente (sem ele não dá para provar onde
    // o banco fica), e a recusa não pode abrir conexão — abrir criaria o arquivo.
    const inexistente = path.join(tmp, 'fantasma.db')

    const { saida, codigo } = rodar(['--falso'], `file:${inexistente}`)

    expect(codigo).not.toBe(0)
    expect(saida).toContain('só roda em banco descartável')
    expect(existsSync(inexistente)).toBe(false)
  })

  it('SYMLINK em /tmp apontando para fora é recusado', { timeout: 90_000 }, () => {
    // A trava de string passaria: o caminho começa com /tmp. Quem escreve é o inode.
    const isca = path.join(tmp, 'parece-descartavel.db')
    symlinkSync(falsaProducao, isca)
    const antes = execFileSync('md5sum', [falsaProducao], { encoding: 'utf8' })

    const { saida, codigo } = rodar(['--falso'], `file:${isca}`)

    expect(codigo).not.toBe(0)
    expect(saida).toContain('só roda em banco descartável')
    // O banner denuncia o destino do link em vez de mostrar só o caminho bonito.
    expect(saida).toContain('→')
    // E o alvo continua intacto.
    expect(execFileSync('md5sum', [falsaProducao], { encoding: 'utf8' })).toBe(antes)
  })

  it('URL não-SQLite tem a credencial OMITIDA da saída', { timeout: 90_000 }, () => {
    const { saida } = rodar(['--falso'], 'postgresql://usuario:senha-secreta@host:5432/hermes')

    expect(saida).not.toContain('senha-secreta')
    expect(saida).toContain('omitido')
  })
})

describe('--sim no processo real, contra banco descartável com job elegível', () => {
  let bancoTmp: string
  let url: string

  beforeAll(async () => {
    bancoTmp = path.join(tmp, 'com-job.db')
    url = `file:${bancoTmp}`
    // Schema no banco de brinquedo.
    execFileSync('npx', ['prisma', 'db', 'push', '--url', url], {
      cwd: RAIZ,
      stdio: 'pipe',
      timeout: 120_000,
    })

    // Semeia com um cliente PRÓPRIO, apontado para o banco de brinquedo. O `db.server` é
    // um singleton preso ao banco do worker do vitest; usá-lo aqui semearia no lugar
    // errado.
    const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3')
    const { PrismaClient } = await import('../generated/prisma/client.js')
    const cliente = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: bancoTmp }) })
    try {
      const tenant = await cliente.tenant.create({
        data: { slug: `sub-${crypto.randomUUID().slice(0, 8)}`, name: 'Demo' },
      })
      const setup = await cliente.aiSetup.create({ data: { tenantId: tenant.id } })
      const { SETUP_FIELDS } = await import('../app/lib/setup/answers')
      const respostas: Record<string, string | string[]> = {}
      for (const campo of SETUP_FIELDS) {
        respostas[campo.key] =
          campo.kind === 'list' ? ['um item bem descritivo'] : 'resposta com folga acima do mínimo'
      }
      const versao = await cliente.aiSetupVersion.create({
        data: {
          setupId: setup.id,
          tenantId: tenant.id,
          state: 'submitted',
          generation: 1,
          answersJson: JSON.stringify(respostas),
        },
      })
      await cliente.aiSetup.update({
        where: { id: setup.id },
        data: { reviewVersionId: versao.id },
      })
      await cliente.aiSetupJob.create({
        data: {
          versionId: versao.id,
          tenantId: tenant.id,
          kind: 'generate',
          generation: 1,
          idempotencyKey: `${versao.id}:1:generate:1`,
        },
      })
    } finally {
      await cliente.$disconnect()
    }
  }, 180_000)

  it('vê o job e NÃO toca em nada', { timeout: 120_000 }, async () => {
    const { saida, codigo } = rodar(['--sim'], url)

    expect(codigo).toBe(0)
    expect(saida).toContain('MODO: SIMULAÇÃO')
    expect(saida).toContain('elegíveis agora: 1')
    expect(saida).toContain('nenhum job foi reivindicado')

    // A prova está no banco, não na saída: o comando poderia dizer qualquer coisa.
    const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3')
    const { PrismaClient } = await import('../generated/prisma/client.js')
    const cliente = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: bancoTmp }) })
    try {
      const job = await cliente.aiSetupJob.findFirstOrThrow()
      expect(job.status).toBe('pending')
      expect(job.attempts).toBe(0)
      expect(job.claimToken).toBeNull()
      expect(job.claimedAt).toBeNull()

      expect(await cliente.aiSetupEvent.count()).toBe(0)

      const versao = await cliente.aiSetupVersion.findFirstOrThrow()
      expect(versao.candidateConfigJson).toBeNull()
      expect(versao.summaryJson).toBeNull()
      expect(versao.state).toBe('submitted')
    } finally {
      await cliente.$disconnect()
    }
  })
})
