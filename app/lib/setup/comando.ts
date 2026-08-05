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

/** Os três jeitos de pedir simulação. Aliases porque `--sim` é ambíguo aqui. */
export const FLAGS_DE_SIMULACAO = ['--sim', '--simular', '--dry-run'] as const

/**
 * Decide o modo.
 *
 * A simulação VENCE qualquer outro flag: quem digitou `--sim` está pedindo para não
 * mexer em nada, e combinar isso com `--falso` é engano — o desfecho seguro é não tocar.
 */
export function interpretarArgumentos(argv: readonly string[]): ModoDoComando {
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
  }
}
