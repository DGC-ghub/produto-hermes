// Como os comandos de terminal da fila leem seus argumentos. PURO: sem banco, sem env.
//
// Está aqui, e não dentro do script, porque o contrato do `--sim` precisa de teste de
// regressão. E precisa por um motivo concreto: neste repositório o MESMO flag significa
// coisas opostas em dois comandos do prefixo `setup:`.
//
//   setup:backfill --sim  →  "sim, aplique": ESCREVE no banco
//   setup:processar --sim →  simulação: NÃO reivindica e NÃO escreve
//
// Enquanto os dois conviverem, uma inversão silenciosa aqui faria um comando escrever
// achando que simula. O teste é a trava.

export type ModoDoComando =
  /** Só olha: conta a fila e sai. Nenhum claim, token, evento, heartbeat ou escrita. */
  | { tipo: 'simular' }
  /** Reivindica e processa com o gerador de mentira, para exercitar o caminho. */
  | { tipo: 'executar_falso' }
  /** Reivindica e processa de verdade. O gerador real entra na etapa 6. */
  | { tipo: 'executar_real' }
  /** Argumento que ninguém reconhece: o comando para em vez de adivinhar. */
  | { tipo: 'argumento_invalido'; argumento: string }

/** Os três jeitos de pedir simulação. Aliases porque `--sim` é ambíguo aqui. */
export const FLAGS_DE_SIMULACAO = ['--sim', '--simular', '--dry-run'] as const

/** Tudo o que o comando aceita. Qualquer outra coisa faz ele parar. */
export const FLAGS_CONHECIDOS: readonly string[] = [...FLAGS_DE_SIMULACAO, '--falso']

/**
 * Decide o modo.
 *
 * Duas regras que existem por segurança, não por gosto:
 *
 *  1. A simulação VENCE qualquer outro flag. Quem digitou `--sim` está pedindo para não
 *     mexer em nada, e combinar com `--falso` é engano — o desfecho seguro é não tocar.
 *  2. Argumento desconhecido PARA o comando. Hoje um `--simulacao` errado cairia em
 *     execução real, que por acaso não faz nada porque o gerador real ainda não existe.
 *     Quando ele entrar (etapa 6), o mesmo erro de digitação passaria a processar de
 *     verdade — bomba-relógio no contrato da linha de comando.
 */
export function interpretarArgumentos(argv: readonly string[]): ModoDoComando {
  const desconhecido = argv.find((arg) => !FLAGS_CONHECIDOS.includes(arg))
  if (desconhecido !== undefined) {
    return { tipo: 'argumento_invalido', argumento: desconhecido }
  }
  if (FLAGS_DE_SIMULACAO.some((flag) => argv.includes(flag))) {
    return { tipo: 'simular' }
  }
  if (argv.includes('--falso')) {
    return { tipo: 'executar_falso' }
  }
  return { tipo: 'executar_real' }
}

/** A primeira linha da saída. Existe porque `--sim` é ambíguo entre os comandos. */
export function descreverModo(modo: ModoDoComando): string {
  switch (modo.tipo) {
    case 'simular':
      return 'MODO: SIMULAÇÃO — nada será reivindicado nem alterado.'
    case 'executar_falso':
      return '⚠️  MODO: EXECUÇÃO com PROCESSADOR FALSO — vai reivindicar e gravar artefato de mentira.'
    case 'executar_real':
      return '⚠️  MODO: EXECUÇÃO — vai reivindicar e alterar jobs.'
    case 'argumento_invalido':
      return `Argumento desconhecido: ${modo.argumento}`
  }
}

// ── setup:revisar ───────────────────────────────────────────────────────────────

export type ArgumentosDeRevisao =
  | { tipo: 'revisar'; slug: string; reviewer: string | undefined; simular: boolean }
  | { tipo: 'argumento_invalido'; argumento: string }
  | { tipo: 'slug_ausente' }
  | { tipo: 'slug_repetido'; segundo: string }

/**
 * Lê `setup:revisar -- <slug> --reviewer <nome> [--sim]`.
 *
 * Mesma disciplina do outro comando: argumento desconhecido PARA, em vez de virar
 * execução por omissão. E o slug é posicional e único — dois slugs na linha significam
 * que a pessoa não sabe qual empresa está revisando, e adivinhar seria o pior desfecho.
 */
export function interpretarArgumentosDeRevisao(argv: readonly string[]): ArgumentosDeRevisao {
  let slug: string | undefined
  let reviewer: string | undefined
  let simular = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (FLAGS_DE_SIMULACAO.includes(arg as (typeof FLAGS_DE_SIMULACAO)[number])) {
      simular = true
      continue
    }
    if (arg === '--reviewer') {
      // O valor pode faltar; quem valida o nome é `normalizarReviewer`, que devolve o
      // motivo certo para a mensagem.
      reviewer = argv[i + 1]
      i += 1
      continue
    }
    if (arg.startsWith('-')) {
      return { tipo: 'argumento_invalido', argumento: arg }
    }
    if (slug !== undefined) {
      return { tipo: 'slug_repetido', segundo: arg }
    }
    slug = arg
  }

  if (slug === undefined) {
    return { tipo: 'slug_ausente' }
  }
  return { tipo: 'revisar', slug, reviewer, simular }
}
