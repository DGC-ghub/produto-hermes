// Regras da fila do onboarding — PURAS: sem banco, sem relógio próprio, sem rede.
//
// Estão separadas do `job.server.ts` porque são DECISÕES (quando re-tentar, o que é falha
// definitiva, o que pode aparecer num campo de erro), e decisão se testa com tabela. O que
// depende do banco — claim atômico, lease, heartbeat — fica do outro lado.
//
// Referência: spec §6.3 (padrão da fila), §6.4 (taxonomia de falhas), §6.5 (backoff e lease).

/** Depois disto o job é veneno: sai da fila para não entupir o drain para sempre. */
export const MAX_ATTEMPTS = 3

/** Lote 1: o Claude CLI tem concorrência 1 — dois jobs juntos só disputariam a vez. */
export const LOTE = 1

/** De quanto em quanto tempo o sweeper acorda. */
export const SWEEP_INTERVAL_MS = 60_000

/** Heartbeat: o dono do lease renova `claimedAt` neste ritmo enquanto trabalha. */
export const HEARTBEAT_INTERVAL_MS = 60_000

/**
 * Sem heartbeat por este tempo, o job é considerado órfão e volta para a fila.
 *
 * São 30 minutos porque um job de agentes roda por MINUTOS: um limite curto devolveria à
 * fila um job que está trabalhando, e aí dois processos gerariam a mesma configuração.
 */
export const LEASE_ORFAO_MS = 30 * 60 * 1000

/** Por que um job falhou. Determina se re-tenta e se alarma (§6.4). */
export type FailureKind =
  /** Provider caiu, timeout, `SQLITE_BUSY` — o mundo lá fora tremeu, tenta de novo. */
  | 'transient'
  /** O agente devolveu algo que não é o JSON esperado. Também vale re-tentar. */
  | 'invalid_output'
  /** Validação determinística reprovou. Insistir daria o mesmo resultado. */
  | 'terminal'
  /** A geração/base mudou no meio: este job ficou obsoleto (§4.8). Ninguém errou. */
  | 'superseded'

export type StatusJob = 'pending' | 'processing' | 'retry_wait' | 'failed' | 'completed'

export type Desfecho = {
  status: Extract<StatusJob, 'retry_wait' | 'failed'>
  /** Chamar alguém agora? Alarme em falha esperada vira ruído e some no meio. */
  alarmar: boolean
}

/**
 * O que fazer com um job que falhou.
 *
 * `transient` e `invalid_output` esperam e voltam; os outros dois acabam ali. A diferença
 * entre `terminal` e `superseded` é quem precisa saber: validação reprovada é problema
 * (alarma), job obsoleto é o sistema funcionando (não alarma).
 */
export function decidirDesfecho(kind: FailureKind, attempts: number): Desfecho {
  if (kind === 'superseded') {
    return { status: 'failed', alarmar: false }
  }
  if (kind === 'terminal') {
    return { status: 'failed', alarmar: true }
  }
  // Esgotou: para de tentar E chama alguém — foi transitório três vezes seguidas, o que
  // já não parece transitório.
  if (attempts >= MAX_ATTEMPTS) {
    return { status: 'failed', alarmar: true }
  }
  return { status: 'retry_wait', alarmar: false }
}

/**
 * Quando a próxima tentativa fica elegível: 1, 2 e 4 minutos (§6.5).
 *
 * A fila do WhatsApp não tem espera — falha volta direto para `pending`. Aqui precisa: sem
 * backoff, uma indisponibilidade de dez segundos do provider queimaria as três tentativas
 * em três segundos e o job morreria por nada.
 *
 * `attempts` é a contagem DEPOIS do incremento do claim (1 na primeira falha).
 */
export function proximaTentativaEm(attempts: number, agora: Date): Date {
  const expoente = Math.max(attempts - 1, 0)
  return new Date(agora.getTime() + 2 ** expoente * 60_000)
}

/** Limite do texto de erro guardado no banco. */
export const ERRO_MAX_CHARS = 200

/**
 * O que pode ser gravado em `lastError`.
 *
 * O erro de um job de agentes carrega, com frequência, um pedaço do prompt ou da saída
 * crua — que contém as respostas da empresa. Isso não entra no banco de fila: fica só a
 * primeira linha, sem quebras, truncada. Quem precisa do detalhe olha o log do processo,
 * que não é auditoria e não é lido por outra empresa.
 */
export function sanitizarErro(error: unknown): string {
  const bruto =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
  const primeiraLinha = bruto.split('\n')[0].replace(/\s+/g, ' ').trim()
  if (primeiraLinha.length === 0) {
    return 'erro sem mensagem'
  }
  return primeiraLinha.length > ERRO_MAX_CHARS
    ? `${primeiraLinha.slice(0, ERRO_MAX_CHARS)}…`
    : primeiraLinha
}

/**
 * O worker automático está ligado?
 *
 * Desligado por padrão, e de propósito (§6.2): o Claude CLI tem concorrência 1 e o drain do
 * WhatsApp é sequencial, então um job de minutos faria mensagem de cliente real esperar e
 * cair no fallback. Ligar exige capacidade separada — não é uma flag de conveniência.
 */
export function workerHabilitado(env: Record<string, string | undefined>): boolean {
  return env.SETUP_WORKER_ENABLED === '1'
}
