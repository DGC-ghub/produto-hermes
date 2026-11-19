import { timingSafeEqual } from 'node:crypto'

/** Compara o token do webhook em tempo constante. Sem token esperado, sempre recusa. */
export function tokenConfere(recebido: string | null | undefined, esperado: string | undefined) {
  if (!esperado || !recebido) {
    return false
  }
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}
