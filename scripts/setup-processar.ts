// Janela ASSISTIDA de processamento da fila do onboarding.
//
// Não existe worker automático (spec §6.2): o Claude CLI tem concorrência 1 e o drain do
// WhatsApp é sequencial, então um job de minutos faria mensagem de cliente real esperar e
// cair no fallback. Quem decide quando processar é uma pessoa, rodando isto.
//
// ⚠️ ATENÇÃO AO `--sim`. Neste comando ele significa SIMULAÇÃO: não reivindica e não
// escreve. Em `scripts/setup-backfill.ts` o MESMO flag significa o oposto — lá `--sim` é
// "sim, aplique" e ESCREVE no banco. Enquanto os dois conviverem, leia o cabeçalho antes
// de digitar; este aqui sempre anuncia o modo na primeira linha da saída.
//
//   npm run setup:processar -- --sim      # só olha: conta a fila, não toca em nada
//   npm run setup:processar -- --falso    # processa UM job com gerador de mentira
//   npm run setup:processar               # processa UM job com o gerador de verdade
//
// O gerador de verdade ainda não existe (etapa 6). Sem `--sim` nem `--falso`, o comando
// recusa em vez de fingir que fez algo.
import { descreverModo, interpretarArgumentos } from '../app/lib/setup/comando'
import type { Processador, ResultadoDaPassada } from '../app/lib/setup/processar.server'

// TUDO o que vem antes dos imports dinâmicos da fila é de propósito — import estático é
// içado para antes de qualquer linha executável, e `db.server.ts` lê `DATABASE_URL` no
// momento em que é carregado.
//
// 1. O sweeper ESCREVE. Num comando de terminal ele não serve (o processo morre antes dos
//    60 s) e num `--sim` quebraria a promessa de não alterar nada.
process.env.SETUP_SWEEPER_OFF = '1'

// 2. Sem `.env`, `db.server.ts` cai no default dele: `file:./dev.db` — que no Pi é o banco
//    do SERVIÇO EM PRODUÇÃO. Todo script deste repositório carrega o `.env` por isso; este
//    era o único que não carregava. `loadEnvFile` não sobrescreve variável já definida,
//    então um `DATABASE_URL` exportado no shell continua vencendo.
try {
  process.loadEnvFile()
} catch {
  // Sem `.env` (ambiente de CI, por exemplo): segue com o que estiver no ambiente. O
  // banco efetivo é impresso adiante de qualquer forma.
}

// Marca se o cliente do banco chegou a ser carregado, para o `finally` não importar
// `db.server` por conta própria num caminho que recusou tocar o banco.
//
// Honestidade sobre o alcance disto: medido, o import seguido de `$disconnect()` NÃO chega
// a criar nem abrir o arquivo SQLite — o adapter do better-sqlite3 é preguiçoso. Ou seja, a
// guarda não conserta um vazamento observável hoje; ela evita depender de um detalhe de
// inicialização de dependência para a promessa "nada foi aberto" continuar verdadeira.
let bancoFoiAberto = false

// A leitura dos argumentos é pura e testada (app/lib/setup/comando.ts) — o contrato do
// `--sim` não pode inverter em silêncio.
const modo = interpretarArgumentos(process.argv.slice(2))

/**
 * Gerador de mentira: artefatos com cara de artefato, para exercitar o caminho inteiro
 * sem gastar o cérebro. NUNCA deve virar o caminho padrão — por isso exige `--falso`.
 */
const processadorFalso: Processador = async (job) => ({
  artefatos: {
    candidateConfigJson: JSON.stringify({
      slug: job.tenantSlug,
      gerado: 'PROCESSADOR FALSO — não use isto para atender ninguém',
    }),
    candidateKnowledgeJson: JSON.stringify([]),
    summaryJson: JSON.stringify({ resumo: 'gerado pelo processador falso' }),
    gapsJson: JSON.stringify([]),
    risksJson: JSON.stringify([]),
    validationJson: JSON.stringify([]),
  },
  temLacunas: false,
})

async function main(): Promise<void> {
  // `banco.server` só olha o filesystem — não abre conexão nenhuma. Pode vir antes das
  // recusas, e precisa: é ele que decide se o comando pode seguir.
  const { avaliarBanco, descreverBanco, explicarRecusa } = await import(
    '../app/lib/setup/banco.server'
  )

  // O MODO e o BANCO vêm primeiro e sempre: `--sim` quer dizer coisas opostas em dois
  // comandos deste repositório, e qual banco está sendo usado é a pergunta que decide se
  // este comando é inofensivo ou não.
  console.log(`\n${descreverModo(modo)}`)
  console.log(`Banco: ${descreverBanco(process.env.DATABASE_URL)}\n`)

  if (modo.tipo === 'argumento_invalido') {
    console.error('Aceito: --sim (ou --simular/--dry-run) e --falso. Nada foi reivindicado.')
    process.exitCode = 1
    return
  }

  // O gerador de mentira só roda em banco DESCARTÁVEL, provado pelo filesystem. Sem esta
  // trava, um `--falso` no Pi gravaria candidata falsa na configuração de empresa de
  // verdade — e o `.env` aponta justamente para lá.
  if (modo.tipo === 'executar_falso') {
    const veredicto = avaliarBanco(process.env.DATABASE_URL)
    if (!veredicto.descartavel) {
      console.error(
        'O --falso grava artefato de MENTIRA e só roda em banco descartável.\n' +
          `Recusado porque ${explicarRecusa(veredicto.motivo)}.\n\n` +
          'Para exercitar o caminho, crie um banco de brinquedo primeiro:\n' +
          '  npx prisma db push --url "file:/tmp/hermes-teste.db"\n' +
          '  DATABASE_URL="file:/tmp/hermes-teste.db" npm run setup:processar -- --falso\n\n' +
          'Nada foi reivindicado e nenhuma conexão foi aberta.',
      )
      process.exitCode = 1
      return
    }
    // Fixa a URL no caminho CANÔNICO que acabou de ser aprovado, antes de o cliente do
    // banco existir. Entre o `realpath` e o Prisma abrir o arquivo há uma janela em que
    // alguém poderia trocar o symlink original; abrir o destino resolvido fecha essa
    // troca. Não elimina toda substituição de inode possível — no modelo atual, operador
    // local confiável, o resíduo é aceito e está registrado aqui.
    process.env.DATABASE_URL = `file:${veredicto.caminhoReal}`
  }

  // Daqui para baixo o banco É tocado. O import abre a conexão.
  const { contarFilaDeSetup, setupWorkerHabilitado } = await import('../app/lib/setup/job.server')
  const { processarProximoJob } = await import('../app/lib/setup/processar.server')
  bancoFoiAberto = true

  const fila = await contarFilaDeSetup()
  console.log('Fila do onboarding')
  console.log(`  elegíveis agora: ${fila.pendentes}`)
  console.log(`  em processamento: ${fila.processando}`)
  console.log(`  esperando backoff: ${fila.esperando}`)
  console.log(`  falhos: ${fila.falhos}`)
  console.log(`  worker automático: ${setupWorkerHabilitado() ? 'LIGADO' : 'desligado'}\n`)

  // O desvio acontece ANTES de qualquer claim: em simulação nada é reivindicado, nenhum
  // token nasce, nenhum evento é gravado e nenhum heartbeat começa.
  if (modo.tipo === 'simular') {
    console.log('Simulação: nenhum job foi reivindicado.')
    if (fila.pendentes > 0) {
      console.log(`Rode sem --sim para processar ${fila.pendentes === 1 ? 'o job' : 'um job'}.`)
    }
    return
  }

  if (modo.tipo === 'executar_real') {
    console.error(
      'Sem gerador: o processador de verdade entra na etapa 6.\n' +
        'Use --sim para inspecionar a fila, ou --falso para exercitar o caminho com um\n' +
        'gerador de mentira. Nada foi reivindicado.',
    )
    process.exitCode = 1
    return
  }

  relatar(await processarProximoJob({ processador: processadorFalso }))
}

/** Traduz o desfecho para quem está lendo o terminal. */
function relatar(resultado: ResultadoDaPassada): void {
  switch (resultado.tipo) {
    case 'nada_a_fazer':
      console.log('Fila vazia: não há job elegível agora.')
      return
    case 'teto_atingido':
      // NUNCA "fila vazia": pode haver job válido logo atrás dos descartados.
      console.error(
        `Inspecionei ${resultado.inspecionados} candidatos e TODOS foram descartados ou\n` +
          'perdidos para outro processo. A fila NÃO está vazia — rode de novo, e se\n' +
          'repetir, olhe os jobs em `failed`: algo está produzindo job inválido.',
      )
      process.exitCode = 1
      return
    case 'concluido':
      console.log(`Job ${resultado.jobId} concluído para ${resultado.tenantSlug}.`)
      if (resultado.comLacunas) {
        console.log('O gerador apontou LACUNAS: a versão voltou ao cliente em needs_changes.')
      } else if (modo.tipo === 'executar_falso') {
        // Recomendar revisão aqui convidaria alguém a aprovar uma candidata que foi
        // gerada de mentira, de propósito.
        console.log(
          'Artefatos de MENTIRA gravados (gerador falso). NÃO revise nem aprove esta\n' +
            'candidata: ela existe só para exercitar o caminho.',
        )
      } else {
        console.log('Artefatos gravados. Próximo passo: `npm run setup:revisar`.')
      }
      return
    case 'recusado':
      console.error(
        `Job ${resultado.jobId} processado, mas o resultado NÃO foi gravado (${resultado.motivo}).\n` +
          'O estado mudou embaixo — geração nova, lease de outro processo ou base\n' +
          'publicada no meio. Nada foi perdido: o job volta pela fila.',
      )
      process.exitCode = 1
      return
    case 'falhou':
      console.error(
        `Job ${resultado.jobId} falhou (${resultado.kind}/${resultado.codigo}) → ${resultado.status}.`,
      )
      process.exitCode = 1
      return
    case 'persistencia_falhou':
      // A FASE muda o que aconteceu de fato. Dizer "o trabalho ficou pronto" quando o
      // processador falhou seria mentira, e mandaria procurar artefato que não existe.
      console.error(
        resultado.fase === 'gravar_artefatos'
          ? `Job ${resultado.jobId}: os artefatos ficaram PRONTOS e o banco não aceitou gravá-los.`
          : `Job ${resultado.jobId}: o processador falhou e o banco não aceitou nem registrar a falha.`,
      )
      if (resultado.status === 'recuperacao_pendente') {
        // Não anunciar `retry_wait` aqui: nada foi escrito, nem a liberação do lease.
        console.error(
          'O banco continuou travado, então NEM a devolução do job à fila passou. Ele\n' +
            'segue em `processing`, com o lease de pé; o heartbeat parou e o sweeper o\n' +
            'recupera quando o lease vencer (30 min). Não há o que fazer além de\n' +
            'destravar o banco.',
        )
      } else {
        console.error(`O job foi para ${resultado.status} e volta pela fila. Veja o hermes.log.`)
      }
      process.exitCode = 1
      return
  }
}

main()
  .catch((error) => {
    // P2021 = tabela inexistente. Acontece quando este comando aponta para um banco em que
    // a migration do onboarding ainda não foi aplicada — o do serviço, hoje, é um deles.
    // Um stack do Prisma aqui faria parecer defeito do comando.
    if ((error as { code?: string })?.code === 'P2021') {
      console.error(
        'As tabelas do onboarding não existem nesse banco.\n' +
          'A migration ainda não foi aplicada nele. Nada foi lido nem escrito.',
      )
      process.exitCode = 1
      return
    }
    console.error('[setup:processar] falhou:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    // Só desconecta o que foi conectado. Importar `db.server` aqui, num caminho que
    // recusou tocar o banco, ABRIRIA a conexão que o comando tinha acabado de evitar.
    if (!bancoFoiAberto) {
      return
    }
    void import('../app/db.server').then(({ db }) => db.$disconnect())
  })
