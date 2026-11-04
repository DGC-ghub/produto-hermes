// O pacote `libsignal` usado pelo Baileys ignora o logger configurado no socket e escreve
// sessões Signal inteiras diretamente em console.info/console.warn. Essas estruturas contêm
// chaves privadas, rootKey e ratchets. Este guard descarta SOMENTE as quatro mensagens do
// libsignal que carregam o objeto de sessão; todos os demais logs seguem normalmente.

const SESSION_DUMP_PREFIXES = new Set([
  'Closing session:',
  'Session already closed',
  'Opening session:',
  'Removing old closed session:',
])

export function containsLibsignalSessionSecret(args: unknown[]): boolean {
  return typeof args[0] === 'string' && SESSION_DUMP_PREFIXES.has(args[0])
}

const INSTALLED = Symbol.for('hermes.libsignal-log-guard.installed')
type GuardedConsole = Console & { [INSTALLED]?: boolean }

/** Instala uma vez por processo; deve rodar antes de criar qualquer socket Baileys. */
export function installLibsignalLogGuard(): void {
  const guarded = console as GuardedConsole
  if (guarded[INSTALLED]) return

  const originalInfo = console.info.bind(console)
  const originalWarn = console.warn.bind(console)

  console.info = (...args: unknown[]) => {
    if (!containsLibsignalSessionSecret(args)) originalInfo(...args)
  }
  console.warn = (...args: unknown[]) => {
    if (!containsLibsignalSessionSecret(args)) originalWarn(...args)
  }
  guarded[INSTALLED] = true
}
