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
// Todos os casos deste arquivo são de RECUSA — nenhum toca banco de verdade.

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
