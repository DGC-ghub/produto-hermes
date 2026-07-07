import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

// Cifra de segredos EM REPOUSO (marco M4): AES-256-GCM. Usada pra guardar credenciais sensíveis
// no banco (ex.: access token do WhatsApp por tenant) sem deixá-las em claro. A chave é derivada
// do SESSION_SECRET (já obrigatório em produção) — não precisa de segredo novo. Server-side.

function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me'
  // scrypt com salt fixo: mesma chave a cada boot (determinística), forte o bastante pra derivar
  // uma chave de 32 bytes a partir do segredo da sessão.
  return scryptSync(secret, 'hermes-secret-encryption-v1', 32)
}

/** Cifra um texto. Formato guardável: `<ivHex>:<tagHex>:<cipherHex>`. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

/** Decifra o que encryptSecret gerou. Lança se o formato/tag for inválido (adulterado). */
export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, encHex] = stored.split(':')
  if (!ivHex || !tagHex || !encHex) {
    throw new Error('segredo cifrado em formato inválido')
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString(
    'utf8',
  )
}
