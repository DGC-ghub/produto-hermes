import type { TenantConfig } from '../attendant/tenant-config'

// Classifica uma alteração de configuração em: nada mudou, publica direto, ou precisa de
// revisão (spec §4.2, §4.5). PURA: sem banco, sem I/O.
//
// A regra é ALLOWLIST, não denylist: só dois caminhos publicam sem ninguém olhar. Tudo o
// mais — inclusive um campo que ainda não existe — cria versão pendente. O motivo é que a
// lista de campos perigosos cresce sozinha (todo campo novo do TenantConfig nasce afetando
// o comportamento da IA), enquanto a lista de campos inócuos só cresce por decisão
// deliberada. Uma denylist esqueceria o campo novo; a allowlist o barra por omissão.
//
// ⚠️ Esta função NUNCA recebe a classificação pronta do cliente. Aceitar `editRisk='safe'`
// de um formulário permitiria publicar preço ou escopo sem revisão (INV-16).

/**
 * Os únicos caminhos que publicam direto. `address` sequer chega ao prompt hoje;
 * `workingHours` entra na persona mas não altera nenhuma decisão determinística.
 */
export const SAFE_CONFIG_PATHS = [
  'businessProfile.workingHours',
  'businessProfile.address',
] as const

export type ConfigDiffResult =
  | 'noop' // nada mudou — não cria versão nenhuma
  | 'safe' // só campos operacionais — publica direto, com auditoria
  | 'risky' // precisa de revisão humana antes de ir ao ar

const SAFE = new Set<string>(SAFE_CONFIG_PATHS)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Caminhos em que os dois objetos diferem, em notação de ponto. Percorre os dois lados,
 * então uma chave presente só num deles também conta como diferença.
 *
 * Arrays são comparados como VALOR (inclusive a ordem): reordenar `neverPromise` muda o
 * prompt, e de todo modo nenhum array está na allowlist — errar para o lado conservador
 * aqui não custa nada.
 *
 * `undefined` e chave ausente são o mesmo: a tela grava `campo || undefined`, e tratá-los
 * como diferentes marcaria como alteração algo que ninguém mexeu.
 */
function diffPaths(a: unknown, b: unknown, prefix = '', out: string[] = []): string[] {
  if (a === b) {
    return out
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diffPaths(a[key], b[key], prefix ? `${prefix}.${key}` : key, out)
    }
    return out
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(prefix)
      return out
    }
    for (let i = 0; i < a.length; i += 1) {
      diffPaths(a[i], b[i], `${prefix}[${i}]`, out)
    }
    return out
  }
  // Um dos lados não é objeto/array, ou os tipos divergem: valor mudou.
  out.push(prefix)
  return out
}

/**
 * Um caminho é seguro se ele mesmo está na allowlist. Caminhos mais fundos (ex.:
 * `businessProfile.workingHours.algo`) NÃO são aceitos: a allowlist descreve campos de
 * texto simples, e uma estrutura aninhada ali significa que o shape mudou — caso para
 * revisão humana, não para publicação automática.
 */
function isSafePath(path: string): boolean {
  return SAFE.has(path)
}

/**
 * Compara a configuração publicada com a recebida e diz o que fazer com ela.
 *
 * Falha ao comparar (entrada que não é objeto, referência circular) devolve `risky`: o
 * default é NEGAR. Uma classificação errada para `safe` publica em produção sem revisão;
 * uma errada para `risky` apenas pede uma revisão a mais.
 */
export function classifyConfigDiff(
  published: TenantConfig,
  incoming: TenantConfig,
): ConfigDiffResult {
  if (!isPlainObject(published) || !isPlainObject(incoming)) {
    return 'risky'
  }
  let paths: string[]
  try {
    paths = diffPaths(published, incoming)
  } catch {
    // Referência circular ou estrutura patológica: não dá para afirmar que é seguro.
    return 'risky'
  }
  if (paths.length === 0) {
    return 'noop'
  }
  return paths.every(isSafePath) ? 'safe' : 'risky'
}
