// Como se nomeia o banco de cada worker da suíte. Separado do setup para ser testável:
// aqui não há efeito nenhum, só a regra.

/** Prefixo dos bancos por worker — e do que o teardown apaga. Ver vitest.global-setup.ts. */
export const TEST_DB_PREFIX = '.test-'

/**
 * Identidade do worker. Precisa distinguir nos DOIS modos de pool do vitest:
 *
 *  - `forks` (default): cada worker é um processo, o `pid` distingue e o `threadId` é 0;
 *  - `threads`: os workers são threads do MESMO processo, o `pid` é igual para todos e
 *    quem distingue é o `threadId`.
 *
 * Usar só o `pid` funcionava por acaso no default e devolvia todas as threads para o mesmo
 * arquivo SQLite sob `--pool=threads` — de volta à inanição de escrita que isto resolve.
 */
export function nomeDoBancoDoWorker(pid: number, threadId: number): string {
  return `${TEST_DB_PREFIX}${pid}-${threadId}.db`
}
