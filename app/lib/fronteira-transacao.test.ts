// A FRONTEIRA DA TRANSAÇÃO — teste estrutural, não de corrida.
//
// Por que este teste existe, e por que ele não é um teste de concorrência:
//
// O adapter better-sqlite3 usa UMA conexão. Quando `db.$transaction` está aberta, qualquer
// query emitida pelo cliente raiz `db` cai DENTRO dessa transação — pode ser sobrescrita pelo
// que a transação gravar depois, e é desfeita se ela der rollback. O mecanismo é real: está em
// node_modules/@prisma/adapter-better-sqlite3 (`executeIO` devolve `Promise.resolve` sobre
// chamadas síncronas; o `#mutex` protege só entre transações, não contra query avulsa).
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
// ── A REGRA É ESTRITA, DE PROPÓSITO ──────────────────────────────────────────────────────
//
// Dentro de uma transação, um `await` só passa se estiver ENRAIZADO DIRETAMENTE no `tx`.
// `await helper(tx)` é RECUSADO mesmo quando o helper é inofensivo.
//
// A versão anterior deste teste aceitava `helper(tx)` sem olhar o corpo do helper, e isso
// deixava exatamente uma porta aberta: bastava esconder a espera lá dentro.
//
//     async function helper(tx) {
//       await new Promise((r) => setTimeout(r, 1))   // ← o defeito, invisível para o scanner
//       return tx.conversation.count()
//     }
//
// Esse mutante sobrevivia. Seguir o helper exigiria resolver declaração local, analisar
// recursivamente, recusar import não resolvido e detectar ciclo — mais mecanismo do que o
// problema merece. A regra estrita custa algumas linhas repetidas dentro das transações e,
// em troca, deixa a fronteira visível no lugar onde ela decide quem tem autoridade sobre a
// conversa. Repetição honesta é melhor que abstração que esconde a fronteira.
//
// Pelo mesmo motivo, o CALLBACK também tem que ser inline: `db.$transaction(finalizar)`
// reprova. A versão anterior resolvia esse nome procurando a primeira declaração homônima no
// arquivo — o que ignora escopo léxico e podia analisar a função ERRADA:
//
//     async function finalizar(tx) { return tx.conversation.count() }   // segura, top-level
//     export function usar() {
//       const finalizar = async (tx) => {                               // perigosa, sombreia
//         await new Promise((r) => setTimeout(r, 1))
//         return tx.conversation.count()
//       }
//       return db.$transaction(finalizar)                               // usa a perigosa
//     }
//
// O scanner encontrava a segura e aprovava. Resolver isso direito exigiria shadowing, blocos,
// imports, overloads, declarações duplicadas e aliases — resolução lexical do TypeScript
// inteira. Para uma fronteira que deve ser explícita, o custo não se paga: exigir o corpo
// escrito dentro do `$transaction` resolve o mesmo problema sem nenhum mecanismo.
//
// Se o adapter deixar de ser síncrono (libsql, node:sqlite async, driver de rede), esta
// proteção deixa de bastar e a serialização vira obrigatória. Quem guarda essa outra premissa
// é `driver-sincrono.test.ts` — os dois protegem lados diferentes do mesmo raciocínio.

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

type Violacao = { arquivo: string; linha: number; trecho: string; motivo: string }

/** Descasca `tx.a.b.c(...)` / `tx.$queryRaw\`...\`` até a raiz do acesso. */
function raizDaChamada(no: ts.Node): ts.Node {
  let alvo = no
  if (ts.isCallExpression(alvo) || ts.isTaggedTemplateExpression(alvo)) {
    alvo = ts.isCallExpression(alvo) ? alvo.expression : alvo.tag
  }
  while (ts.isPropertyAccessExpression(alvo) || ts.isElementAccessExpression(alvo)) {
    alvo = alvo.expression
  }
  return alvo
}

/**
 * ESTRITO: a expressão aguardada tem que estar enraizada no próprio `tx`.
 * `helper(tx)` não passa — o corpo do helper não é visível daqui, e foi por essa fresta que
 * o mutante da espera escondida passou.
 */
function enraizadoEmTx(expressao: ts.Node, tx: string): boolean {
  if (!ts.isCallExpression(expressao) && !ts.isTaggedTemplateExpression(expressao)) return false
  const raiz = raizDaChamada(expressao)
  return ts.isIdentifier(raiz) && raiz.text === tx
}

function violacoesDe(arquivo: string): Violacao[] {
  const texto = readFileSync(arquivo, 'utf8')
  const fonte = ts.createSourceFile(
    arquivo,
    texto,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(arquivo) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const violacoes: Violacao[] = []
  const relativo = path.relative(process.cwd(), arquivo)

  function registrar(no: ts.Node, motivo: string) {
    const { line } = fonte.getLineAndCharacterOfPosition(no.getStart(fonte))
    violacoes.push({
      arquivo: relativo,
      linha: line + 1,
      trecho: no.getText(fonte).split('\n')[0].slice(0, 100),
      motivo,
    })
  }

  function inspecionarCorpo(corpo: ts.Node, tx: string) {
    function caminhar(no: ts.Node) {
      // Transação aninhada tem o próprio `tx`; quem cuida dela é a visita externa.
      if (ehChamadaDeTransacao(no)) return
      if (ts.isAwaitExpression(no) && !enraizadoEmTx(no.expression, tx)) {
        registrar(no, 'await não enraizado no tx da transação')
      }
      ts.forEachChild(no, caminhar)
    }
    // `caminhar(corpo)` e não `forEachChild(corpo, ...)`: quando o callback tem corpo de
    // EXPRESSÃO (`async (tx) => await helper(tx)`), o próprio corpo já é o `await`. Descer
    // direto para os filhos pulava exatamente esse nó — e era assim que a espera escondida
    // num helper continuava passando, mesmo com a regra estrita no lugar.
    caminhar(corpo)
  }

  function ehChamadaDeTransacao(no: ts.Node): no is ts.CallExpression {
    return ts.isCallExpression(no) && no.expression.getText(fonte).endsWith('$transaction')
  }

  function visitar(no: ts.Node) {
    if (ehChamadaDeTransacao(no)) {
      const argumento = no.arguments[0]

      if (argumento && (ts.isArrowFunction(argumento) || ts.isFunctionExpression(argumento))) {
        const parametro = argumento.parameters[0]
        if (parametro && argumento.body) {
          inspecionarCorpo(argumento.body, parametro.name.getText(fonte))
        }
      } else if (argumento && !ts.isArrayLiteralExpression(argumento)) {
        // `$transaction([...])` em lote não tem callback e não abre janela. Qualquer outra
        // forma — callback extraído por nome, importado, devolvido por fábrica — reprova.
        registrar(
          no,
          'callback de transação não é inline — escreva o corpo dentro do `$transaction`',
        )
      }
    }
    ts.forEachChild(no, visitar)
  }

  visitar(fonte)
  return violacoes
}

describe('fronteira da transação', () => {
  const arquivos = arquivosDeFonte(RAIZ_APP)

  it('enxerga as transações do projeto (não pode passar por não achar nada)', () => {
    const comTransacao = arquivos.filter((a) => readFileSync(a, 'utf8').includes('$transaction'))
    // Guarda contra o pior desfecho: passar em silêncio porque parou de enxergar o código.
    expect(comTransacao.length).toBeGreaterThanOrEqual(5)
  })

  it('nenhum await dentro de $transaction escapa do tx', () => {
    const violacoes = arquivos.flatMap(violacoesDe)
    const relatorio = violacoes
      .map((v) => `  ${v.arquivo}:${v.linha}  →  ${v.trecho}\n      (${v.motivo})`)
      .join('\n')

    // A mensagem precisa ensinar, não só reprovar: quem esbarrar nisto daqui a seis meses
    // não vai ter o contexto do dia em que a medição foi feita.
    expect(
      violacoes,
      violacoes.length === 0
        ? ''
        : `\nawait que não opera diretamente sobre o \`tx\`:\n\n${relatorio}\n\n` +
            'Com o adapter better-sqlite3 (conexão única), um await que devolve o controle ao\n' +
            'event loop deixa outra requisição emitir queries DENTRO desta transação: elas podem\n' +
            'ser sobrescritas pelo que vier depois, ou desfeitas pelo rollback. É assim que a\n' +
            'tomada humana ("assumir") vira `needs_human` e o operador perde a conversa.\n\n' +
            'A regra é estrita: `await helper(tx)` também reprova, porque o corpo do helper não é\n' +
            'visível daqui e a espera pode estar escondida lá dentro. Escreva a chamada `tx.*`\n' +
            'direto no corpo da transação — repetir três linhas é melhor que esconder a fronteira.\n\n' +
            'Se precisar mesmo de espera aqui dentro, a serialização deixa de ser opcional e isto\n' +
            'vira decisão de arquitetura, não ajuste local.',
    ).toEqual([])
  })
})
