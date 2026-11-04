import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  avaliarBanco,
  caminhoDoBanco,
  descreverBanco,
  estaDentroDaRaiz,
  explicarRecusa,
} from './banco.server'

// Com arquivos DE VERDADE. Comparar prefixo de string aqui provaria a forma da regra e não
// a garantia: um symlink `/tmp/x.db → dev.db` passa por qualquer teste de string e escreve
// no banco do serviço.

let raiz: string
/** Um "banco de produção" de mentira, FORA do /tmp, para os testes de symlink e hardlink. */
let falsaProducao: string

beforeAll(() => {
  raiz = mkdtempSync(path.join(tmpdir(), 'hermes-banco-'))
  // Fora do tmp real: usa o diretório do projeto, que é onde o dev.db mora de verdade.
  falsaProducao = path.join(process.cwd(), `.falsa-producao-${process.pid}.db`)
  writeFileSync(falsaProducao, 'não sou descartável')
})

afterAll(() => {
  rmSync(raiz, { recursive: true, force: true })
  rmSync(falsaProducao, { force: true })
})

/** Cria um arquivo dentro do tmp descartável e devolve a URL dele. */
function bancoEm(nome: string): string {
  const alvo = path.join(raiz, nome)
  writeFileSync(alvo, 'banco de brinquedo')
  return `file:${alvo}`
}

describe('descartável de verdade', () => {
  it('arquivo comum dentro do tmp', () => {
    const veredicto = avaliarBanco(bancoEm('ok.db'))
    expect(veredicto.descartavel).toBe(true)
  })

  it('caminho relativo é resolvido antes de julgar', () => {
    const alvo = path.join(raiz, 'relativo.db')
    writeFileSync(alvo, 'x')
    const relativo = path.relative(process.cwd(), alvo)
    expect(avaliarBanco(`file:${relativo}`).descartavel).toBe(true)
  })

  it('.. no meio do caminho não engana', () => {
    const alvo = path.join(raiz, 'dotdot.db')
    writeFileSync(alvo, 'x')
    expect(avaliarBanco(`file:${path.join(raiz, 'sub', '..', 'dotdot.db')}`).descartavel).toBe(true)
  })
})

describe('o que NÃO é descartável', () => {
  it('SYMLINK dentro do tmp apontando para fora — o caso que motiva olhar o disco', () => {
    // `/tmp/parece-teste.db → <projeto>/.falsa-producao.db`. Passa por qualquer regra de
    // string e escreve no arquivo de produção.
    const isca = path.join(raiz, 'parece-teste.db')
    symlinkSync(falsaProducao, isca)

    const veredicto = avaliarBanco(`file:${isca}`)

    expect(veredicto).toEqual({ descartavel: false, motivo: 'fora_do_tmp' })
  })

  it('arquivo com mais de um nome no disco (HARDLINK)', () => {
    // O `realpath` não desfaz hardlink — o caminho continua dentro do tmp. Quem denuncia é
    // o contador de nomes do inode.
    //
    // O ataque que isto guarda é o hardlink APONTANDO PARA PRODUÇÃO, e ele não é
    // construtível nesta máquina: `/tmp` é tmpfs e o projeto está em outro dispositivo,
    // então `link()` devolve EXDEV. O que dá para exercitar é a regra em si, com os dois
    // nomes dentro do tmp — e é ela que barraria o caso perigoso onde ele for possível.
    const original = path.join(raiz, 'original.db')
    writeFileSync(original, 'x')
    const gemeo = path.join(raiz, 'gemeo.db')
    linkSync(original, gemeo)

    expect(avaliarBanco(`file:${gemeo}`)).toEqual({ descartavel: false, motivo: 'tem_hardlink' })
  })

  it('arquivo que não existe: sem prova, sem permissão', () => {
    expect(avaliarBanco(`file:${path.join(raiz, 'fantasma.db')}`)).toEqual({
      descartavel: false,
      motivo: 'nao_existe',
    })
  })

  it('diretório não é banco', () => {
    const dir = path.join(raiz, 'uma-pasta')
    mkdirSync(dir)
    expect(avaliarBanco(`file:${dir}`)).toEqual({
      descartavel: false,
      motivo: 'nao_e_arquivo_regular',
    })
  })

  it('arquivo fora do tmp', () => {
    expect(avaliarBanco(`file:${falsaProducao}`)).toEqual({
      descartavel: false,
      motivo: 'fora_do_tmp',
    })
  })

  it.each([
    ['postgres com credencial', 'postgresql://usuario:senha@host/db'],
    ['ausente', undefined],
    ['vazia', ''],
    ['file: sem caminho', 'file:'],
  ])('%s não é SQLite descartável', (_rotulo, url) => {
    expect(avaliarBanco(url).descartavel).toBe(false)
  })
})

describe('o que pode ser impresso', () => {
  it('URL não-SQLite tem o endereço OMITIDO', () => {
    // Ela carrega usuário e senha no próprio texto; o operador precisa saber que não é
    // SQLite, não precisa ver a credencial na tela nem no log.
    const texto = descreverBanco('postgresql://usuario:senha@host:5432/hermes')
    expect(texto).not.toContain('senha')
    expect(texto).not.toContain('usuario')
    expect(texto).not.toContain('host')
    expect(texto).toContain('omitido')
  })

  it('SQLite aparece com caminho ABSOLUTO', () => {
    const alvo = path.join(raiz, 'mostrar.db')
    writeFileSync(alvo, 'x')
    const relativo = path.relative(process.cwd(), alvo)
    expect(descreverBanco(`file:${relativo}`)).toContain(raiz)
  })

  it('symlink mostra PARA ONDE aponta', () => {
    // Sem isto o banner diria "/tmp/…" enquanto a escrita iria para produção.
    const isca = path.join(raiz, 'isca-visivel.db')
    symlinkSync(falsaProducao, isca)
    const texto = descreverBanco(`file:${isca}`)
    expect(texto).toContain('→')
    expect(texto).toContain(falsaProducao)
  })

  it('sem DATABASE_URL, diz qual é o default', () => {
    // É o caso perigoso: o default do db.server é o banco do serviço no Pi.
    expect(descreverBanco(undefined)).toContain('dev.db')
  })
})

describe('caminhoDoBanco', () => {
  it('resolve para absoluto', () => {
    expect(caminhoDoBanco('file:./dev.db')).toBe(path.resolve('./dev.db'))
  })

  it('devolve null para o que não é file:', () => {
    expect(caminhoDoBanco('postgresql://x/y')).toBeNull()
    expect(caminhoDoBanco(undefined)).toBeNull()
  })
})

describe('cada recusa tem explicação própria', () => {
  it.each([
    ['nao_e_sqlite'],
    ['nao_existe'],
    ['nao_e_arquivo_regular'],
    ['fora_do_tmp'],
    ['tem_hardlink'],
  ] as const)('%s', (motivo) => {
    // Mensagem genérica faria a pessoa tentar de novo do mesmo jeito.
    expect(explicarRecusa(motivo).length).toBeGreaterThan(20)
  })
})

describe('estaDentroDaRaiz — a regra de pertencimento, isolada', () => {
  // Está separada do `avaliarBanco` porque a raiz DELE não é configurável: um parâmetro ali
  // deixaria qualquer chamador apontar o diretório do banco real como "raiz descartável" e
  // transformar a fronteira num carimbo. Aqui a regra é testável sem abrir essa porta.

  it('o próprio diretório da raiz conta como dentro', () => {
    expect(estaDentroDaRaiz('/tmp', '/tmp')).toBe(true)
  })

  it('arquivo dentro da raiz', () => {
    expect(estaDentroDaRaiz('/tmp/x.db', '/tmp')).toBe(true)
    expect(estaDentroDaRaiz('/tmp/a/b/x.db', '/tmp')).toBe(true)
  })

  it('irmão que só COMPARTILHA O PREFIXO está fora', () => {
    // O caso que uma comparação por `startsWith` sem separador deixaria passar. Criar
    // `/tmpfoo` de verdade exige root, então a regra é exercitada aqui.
    expect(estaDentroDaRaiz('/tmpfoo/x.db', '/tmp')).toBe(false)
    expect(estaDentroDaRaiz('/tmp-outro/x.db', '/tmp')).toBe(false)
  })

  it('caminho totalmente fora', () => {
    expect(estaDentroDaRaiz('/home/pi/projects/produto-hermes/dev.db', '/tmp')).toBe(false)
  })
})
