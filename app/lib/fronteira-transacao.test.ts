// A FRONTEIRA DA TRANSAÇÃO — teste estrutural, não de corrida.
//
// Por que este teste existe, e por que ele não é um teste de concorrência:
//
// O adapter better-sqlite3 usa UMA conexão. Quando `db.$transaction` está aberta, qualquer
// query emitida pelo cliente raiz `db` cai DENTRO dessa transação — pode ser sobrescrita pelo
// que a transação gravar depois, e é desfeita se ela der rollback. O mecanismo é real:
// está em node_modules/@prisma/adapter-better-sqlite3 (`executeIO` devolve `Promise.resolve`
// sobre chamadas síncronas; o `#mutex` protege só entre transações).
//
// Só que hoje ele é INALCANÇÁVEL, e a razão é delicada: better-sqlite3 é síncrono e o adapter
// resolve com `Promise.resolve`, então todo `await tx.*` é microtask. A fila de microtasks
// drena até esvaziar antes de o event loop voltar às fases de timers/poll/check — ou seja,
// entre o BEGIN e o COMMIT o processo não atende mais nada, e a escrita do operador não tem
// por onde entrar. Medido: 0 voltas do event loop dentro da transação, 0 violações em 40
// corridas; com UM `await setTimeout(1)` injetado depois do CAS, 40 violações em 40.
//
// Isso significa que a segurança de hoje NÃO vem do código de conversa — vem de uma premissa
// sobre o driver. Um teste de corrida contra o código atual nasceria verde e continuaria verde
// mesmo se a proteção fosse removida: seria um teste que não testa nada.
//
// O que de fato quebra a premissa é um `await` que devolva o controle ao event loop DENTRO de
// uma transação — `await fetch`, `await fs`, `await sleep`, `await` de push/notificação, ou um
// `await` do cliente raiz `db` em vez do `tx`. É exatamente isso que este teste proíbe.
//
// Se algum dia o adapter deixar de ser síncrono (libsql, node:sqlite async, driver de rede),
// esta proteção deixa de ser suficiente e a serialização passa a ser obrigatória.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const RAIZ_APP = path.join(process.cwd(), 'app')

function arquivosDeFonte(dir: string): string[] {
  const saida: string[] = []
  for (const entrada of readdirSync(dir)) {
    const alvo = path.join(dir, entrada)
    if (statSync(alvo).isDirectory()) {
      saida.push(...arquivosDeFonte(alvo))
      continue
    }
    if (!/\.tsx?$/.test(entrada)) continue
    if (/\.test\.tsx?$/.test(entrada)) continue
    saida.push(alvo)
  }
  return saida
}

type Violacao = { arquivo: string; linha: number; trecho: string }

/** O `await` é aceitável se opera sobre o `tx` da transação — direto ou por um helper que o recebe. */
function usaTx(no: ts.Node, tx: string): boolean {
  if (ts.isIdentifier(no) && no.text === tx) return true

  if (ts.isCallExpression(no)) {
    // `tx.algo.metodo(...)` — a raiz do acesso é o tx.
    let alvo: ts.Node = no.expression
    while (ts.isPropertyAccessExpression(alvo)) alvo = alvo.expression
    if (ts.isIdentifier(alvo) && alvo.text === tx) return true

    // `helper(tx, ...)` — a transação foi passada adiante, então o helper opera dentro dela.
    return no.arguments.some((arg) => usaTx(arg, tx))
  }

  return false
}

function violacoesDe(arquivo: string): Violacao[] {
  const fonte = ts.createSourceFile(
    arquivo,
    readFileSync(arquivo, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(arquivo) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const violacoes: Violacao[] = []

  function inspecionarCorpo(corpo: ts.Node, tx: string) {
    function caminhar(no: ts.Node) {
      // Uma transação aninhada tem o próprio `tx`; quem cuida dela é a visita de fora.
      if (ts.isCallExpression(no) && no.expression.getText(fonte).endsWith('$transaction')) return

      if (ts.isAwaitExpression(no) && !usaTx(no.expression, tx)) {
        const { line } = fonte.getLineAndCharacterOfPosition(no.getStart(fonte))
        violacoes.push({
          arquivo: path.relative(process.cwd(), arquivo),
          linha: line + 1,
          trecho: no.getText(fonte).split('\n')[0].slice(0, 100),
        })
      }
      ts.forEachChild(no, caminhar)
    }
    ts.forEachChild(corpo, caminhar)
  }

  function visitar(no: ts.Node) {
    if (ts.isCallExpression(no) && no.expression.getText(fonte).endsWith('$transaction')) {
      const callback = no.arguments[0]
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const parametro = callback.parameters[0]
        if (parametro && callback.body) {
          inspecionarCorpo(callback.body, parametro.name.getText(fonte))
        }
      }
    }
    ts.forEachChild(no, visitar)
  }

  visitar(fonte)
  return violacoes
}

describe('fronteira da transação', () => {
  const arquivos = arquivosDeFonte(RAIZ_APP)

  it('encontra as transações do projeto (o teste não pode passar por não achar nada)', () => {
    const comTransacao = arquivos.filter((a) => readFileSync(a, 'utf8').includes('$transaction'))
    // Guarda contra o pior desfecho deste teste: passar em silêncio porque parou de enxergar
    // o código. Se as transações mudarem de lugar, este número muda e alguém olha.
    expect(comTransacao.length).toBeGreaterThanOrEqual(5)
  })

  it('nenhum await dentro de $transaction escapa do tx', () => {
    const violacoes = arquivos.flatMap(violacoesDe)

    // A mensagem precisa ensinar, não só reprovar: quem esbarrar nisto daqui a seis meses
    // não vai ter o contexto do dia em que a medição foi feita.
    const relatorio = violacoes.map((v) => `  ${v.arquivo}:${v.linha}  →  ${v.trecho}`).join('\n')

    expect(
      violacoes,
      violacoes.length === 0
        ? ''
        : `\nawait que não opera sobre o \`tx\` dentro de uma transação:\n\n${relatorio}\n\n` +
            'Com o adapter better-sqlite3 (conexão única), um await que devolve o controle ao\n' +
            'event loop deixa outra requisição emitir queries DENTRO desta transação: elas podem\n' +
            'ser sobrescritas pelo que vier depois, ou desfeitas pelo rollback. É assim que a\n' +
            'tomada humana ("assumir") vira `needs_human` e o operador perde a conversa.\n\n' +
            'Saídas: use `tx` em vez de `db`; passe `tx` ao helper; ou tire a espera para fora\n' +
            'da transação. Se precisar mesmo de I/O aqui dentro, a serialização deixa de ser\n' +
            'opcional e isto vira uma decisão de arquitetura, não um ajuste local.',
    ).toEqual([])
  })
})
