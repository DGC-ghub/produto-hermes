import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

// Cifra de segredos EM REPOUSO (marco M4): AES-256-GCM. Guarda credenciais sensíveis no banco
// (ex.: access token do WhatsApp por tenant) sem deixá-las em claro. A chave é derivada do
// SESSION_SECRET (já obrigatório em produção). O `context` (AAD) VINCULA o ciphertext a um escopo
// (passe `tenant:<id>`): decifrar com outro contexto falha, então um segredo de um tenant não pode
// ser reusado noutro (previne confused-deputy cross-tenant). Server-side.

// Memoiza a chave derivada POR SEGREDO: o scrypt (dezenas de ms, síncrono) travava
// o event-loop único a cada cifra — e o auth-state do Baileys grava com muita
// frequência. A chave só depende do SESSION_SECRET (constante no processo), então
// cachear é seguro; a chave é por-segredo pra não quebrar testes que o trocam.
let cachedKey: { secret: string; key: Buffer } | null = null

function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET
  // Fail-closed em produção (espelha auth.server.ts): sem um segredo próprio, cifrar em repouso com
  // o default público do código-fonte é falsa sensação de segurança — recusa em vez de fingir.
  if (
    process.env.NODE_ENV === 'production' &&
    (!secret || secret === 'dev-insecure-secret-change-me')
  ) {
    throw new Error('SESSION_SECRET é obrigatório em produção para cifrar segredos em repouso.')
  }
  const effective = secret ?? 'dev-insecure-secret-change-me'
  if (cachedKey?.secret === effective) {
    return cachedKey.key
  }
  const key = scryptSync(effective, 'hermes-secret-encryption-v1', 32)
  cachedKey = { secret: effective, key }
  return key
}

/**
 * Cifra um texto. `context` (opcional, AAD) amarra a cifra a um escopo — passe algo como
 * `tenant:<id>` pra impedir que o segredo seja reusado noutro tenant. Formato guardável:
 * `<ivHex>:<tagHex>:<cipherHex>`.
 */
export function encryptSecret(plain: string, context = ''): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv)
  if (context) {
    cipher.setAAD(Buffer.from(context, 'utf8'))
  }
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

/** Decifra o que encryptSecret gerou COM O MESMO `context`. Lança se formato/tag/contexto não bate. */
export function decryptSecret(stored: string, context = ''): string {
  const [ivHex, tagHex, encHex] = stored.split(':')
  if (!ivHex || !tagHex || !encHex) {
    throw new Error('segredo cifrado em formato inválido')
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivHex, 'hex'))
  if (context) {
    decipher.setAAD(Buffer.from(context, 'utf8'))
  }
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString(
    'utf8',
  )
}
