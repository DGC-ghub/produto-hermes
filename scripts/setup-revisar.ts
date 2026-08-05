// Assumir uma revisão interna (spec §11.1).
//
// Assumir NÃO é aprovar: este comando só marca quem está com o material na mão, para dois
// revisores não trabalharem na mesma versão sem saber. Aprovar e pedir correção são
// comandos próprios.
//
// ⚠️ `--sim` aqui significa SIMULAÇÃO — não assume nada. Em `setup-backfill.ts` o mesmo
// flag significa o oposto ("sim, aplique") e ESCREVE. Este comando sempre anuncia o modo e
// o banco na primeira linha.
//
//   npm run setup:revisar -- <slug> --reviewer "Seu Nome" --sim   # só mostra
//   npm run setup:revisar -- <slug> --reviewer "Seu Nome"         # assume
//
// `INTERNAL_REVIEWER` preenche o nome quando `--reviewer` falta, e o comando imprime qual
// nome vai para a auditoria antes de agir (§11.2).
import { hostname, userInfo } from 'node:os'
import { type ArgumentosDeRevisao, interpretarArgumentosDeRevisao } from '../app/lib/setup/comando'

// Antes de qualquer import dos módulos da fila — import estático é içado para antes de
// qualquer linha executável, e `db.server` lê `DATABASE_URL` ao ser carregado.
//
// 1. O sweeper ESCREVE, e num comando de terminal ele não serve (o processo morre antes
//    dos 60 s). Num `--sim` quebraria a promessa de não alterar nada.
process.env.SETUP_SWEEPER_OFF = '1'

// 2. Sem `.env`, `db.server` cai em `file:./dev.db` — no Pi, o banco do SERVIÇO. Carregar
//    aqui é o que torna o banco efetivo explícito; `loadEnvFile` não sobrescreve o que já
//    estiver no ambiente, então um `DATABASE_URL` exportado continua vencendo.
try {
  process.loadEnvFile()
} catch {
  // Sem `.env`: segue com o ambiente. O banco efetivo é impresso de qualquer forma.
}

const args = interpretarArgumentosDeRevisao(process.argv.slice(2))

// Marca se o cliente do banco chegou a ser carregado. Sem isto, o caminho que afirma parar
// "antes de abrir o banco" (revisor ausente, por exemplo) importava `db.server` no
// `finally` só para desconectar.
//
// Mesma honestidade do setup:processar: medido, o import seguido de `$disconnect()` NÃO
// chega a criar nem abrir o arquivo SQLite — o adapter é preguiçoso. A guarda não conserta
// vazamento observável hoje; ela evita depender desse detalhe de inicialização para a
// promessa continuar verdadeira. Por isso a mutação dela não derruba teste.
let bancoFoiAberto = false

const USO =
  'Uso: npm run setup:revisar -- <slug> --reviewer "Seu Nome" [--sim]\n' +
  'O --sim mostra a situação sem assumir nada.'

/** Traduz a recusa de argumento em algo que explique o que fazer. */
function explicarArgumentos(args: Exclude<ArgumentosDeRevisao, { tipo: 'revisar' }>): string {
  switch (args.tipo) {
    case 'slug_ausente':
      return 'Falta o slug da empresa.'
    case 'slug_repetido':
      return (
        `Dois slugs na linha ("${args.segundo}" veio depois do primeiro).\n` +
        'Qual empresa você quer revisar? Não vou adivinhar.'
      )
    case 'valor_ausente':
      // O caso perigoso: `--reviewer --sim` consumiria a flag como nome, perderia a
      // simulação e gravaria "--sim" na auditoria.
      return (
        `O ${args.flag} precisa de um NOME depois dele` +
        `${args.seguido_de === undefined ? ', e a linha terminou aí.' : `, e veio "${args.seguido_de}".`}\n` +
        'Uma flag não é nome de revisor — e engolir a flag mudaria o que o comando faz.'
      )
    case 'flag_repetida':
      return `O ${args.flag} apareceu duas vezes. Qual nome deve ir para a auditoria?`
    case 'argumento_invalido':
      return `Argumento desconhecido: ${args.argumento}`
  }
}

async function main(): Promise<void> {
  const { descreverBanco } = await import('../app/lib/setup/banco.server')
  const { normalizarReviewer } = await import('../app/lib/setup/revisao')

  if (args.tipo !== 'revisar') {
    console.error(`${explicarArgumentos(args)}\n${USO}`)
    process.exitCode = 1
    return
  }

  // O nome vai para a auditoria, então é conferido ANTES de qualquer leitura do banco.
  const lido = normalizarReviewer(args.reviewer ?? process.env.INTERNAL_REVIEWER)
  if (!lido.ok) {
    console.error(
      lido.motivo === 'ausente'
        ? 'Falta o revisor. Passe --reviewer "Seu Nome" ou defina INTERNAL_REVIEWER.\n' +
            'O nome vai para a auditoria: é a resposta para "quem assumiu esta revisão?".'
        : 'Nome de revisor curto demais. Iniciais não identificam ninguém meses depois.',
    )
    process.exitCode = 1
    return
  }
  const reviewer = lido.nome

  console.log(
    args.simular
      ? '\nMODO: SIMULAÇÃO — nada será assumido.'
      : '\n⚠️  MODO: EXECUÇÃO — vai assumir a revisão em seu nome.',
  )
  console.log(`Banco:   ${descreverBanco(process.env.DATABASE_URL)}`)
  console.log(`Revisor: ${reviewer}@${hostname()}`)
  console.log(`Empresa: ${args.slug}\n`)

  const { assumirRevisao, olharRevisao } = await import('../app/lib/setup/revisao.server')
  bancoFoiAberto = true

  // A situação é mostrada SEMPRE, antes de agir (§11): ninguém assume às cegas.
  const visao = await olharRevisao(args.slug)
  if (!visao) {
    console.error(`Empresa "${args.slug}" não existe. Nada foi assumido.`)
    process.exitCode = 1
    return
  }
  if (!visao.versao) {
    console.log(`${visao.tenant.name}: nenhuma versão em elaboração. Nada a revisar.`)
    return
  }

  const v = visao.versao
  console.log(`${visao.tenant.name}`)
  console.log(`  versão:    ${v.id}`)
  console.log(`  geração:   ${v.generation}`)
  console.log(`  estado:    ${v.state}`)
  console.log(`  enviada:   ${v.submittedAt?.toISOString() ?? '—'}`)
  console.log(`  correções: ${v.changesRequested}`)
  console.log(`  job:       ${visao.job?.status ?? 'nenhum nesta geração'}`)
  console.log(`  artefatos: ${visao.problemas.length === 0 ? 'prontos' : 'COM PROBLEMA'}`)
  for (const problema of visao.problemas) {
    console.log(`    - ${problema.campo}: ${problema.motivo}`)
  }
  console.log(`  base:      ${visao.baseValida ? 'válida' : 'MUDOU desde o envio'}`)
  console.log(
    `  revisor:   ${v.reviewer ? `${v.reviewer} desde ${v.reviewStartedAt?.toISOString()}` : 'ninguém assumiu'}\n`,
  )

  if (args.simular) {
    // O desvio acontece ANTES do claim: em simulação nada é marcado e nenhum evento nasce.
    console.log('Simulação: nada foi assumido.')
    return
  }

  relatar(
    await assumirRevisao({
      tenantSlug: args.slug,
      reviewer,
      hostname: hostname(),
      usuarioDoProcesso: userInfo().username,
    }),
  )
}

type Resultado = Awaited<
  ReturnType<Awaited<typeof import('../app/lib/setup/revisao.server')>['assumirRevisao']>
>

/** Traduz o desfecho para quem está no terminal. */
function relatar(resultado: Resultado): void {
  switch (resultado.tipo) {
    case 'assumida':
      console.log(`Revisão assumida. A versão continua em submitted — assumir não é aprovar.`)
      return
    case 'ja_assumida':
      // Dizer QUEM evita a pessoa ficar tentando de novo.
      console.error(
        `Outro revisor assumiu primeiro: ${resultado.reviewer ?? '(sem nome)'}` +
          `${resultado.desde ? `, desde ${resultado.desde.toISOString()}` : ''}.`,
      )
      process.exitCode = 1
      return
    case 'job_nao_concluido':
      console.error(
        `O job desta geração está em "${resultado.statusDoJob ?? 'inexistente'}".\n` +
          'Assumir agora faria o relógio da revisão medir espera do job, não trabalho.\n' +
          'Rode `npm run setup:processar` antes.',
      )
      process.exitCode = 1
      return
    case 'artefatos_ausentes':
      console.error('Os artefatos não servem para revisão:')
      for (const problema of resultado.problemas) {
        console.error(`  - ${problema.campo}: ${problema.motivo}`)
      }
      console.error('Rode o job de novo ou investigue a última execução.')
      process.exitCode = 1
      return
    case 'base_mudou':
      console.error(
        'A configuração publicada mudou depois do envio (§4.8): esta candidata foi\n' +
          'pensada sobre outra base. Aprová-la desfaria uma correção que já está no ar.\n' +
          'O cliente precisa reenviar para gerar sobre a versão atual.',
      )
      process.exitCode = 1
      return
    case 'estado_invalido':
      console.error(`A versão está em "${resultado.estado}", e só se revisa "submitted".`)
      process.exitCode = 1
      return
    case 'tenant_desconhecido':
    case 'nada_pendente':
      console.error('Nada pendente para esta empresa.')
      process.exitCode = 1
      return
  }
}

main()
  .catch((error) => {
    if ((error as { code?: string })?.code === 'P2021') {
      console.error(
        'As tabelas do onboarding não existem nesse banco.\n' +
          'A migration ainda não foi aplicada nele. Nada foi lido nem escrito.',
      )
      process.exitCode = 1
      return
    }
    console.error('[setup:revisar] falhou:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    if (!bancoFoiAberto) {
      return
    }
    void import('../app/db.server').then(({ db }) => db.$disconnect())
  })
