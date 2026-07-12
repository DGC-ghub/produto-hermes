import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys'
import {
  BufferJSON,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
} from '@whiskeysockets/baileys'
import { db } from '../../db.server'
import { decryptSecret, encryptSecret } from '../crypto.server'

// Auth-state do Baileys persistido no banco (ChannelSession.authStateEnc), CIFRADO.
// Espelha o useMultiFileAuthState, mas resolve os furos que a verificação apontou:
//  - BufferJSON: as chaves Signal são Buffer; JSON puro as corromperia ("Bad MAC" →
//    forçaria re-escanear o QR). BufferJSON.replacer/reviver preserva os Buffers.
//  - persiste no keys.set() E no saveCreds: as `keys` (sessões Signal, pre-keys)
//    são gravadas via keys.set() DURANTE a sessão e NÃO disparam creds.update;
//    persistir só no creds.update perderia as keys → reconexão inválida.
//  - AAD por-sessão: um tenant pode ter várias sessões; o blob só decifra na sua.
//  - debounce: o Baileys grava com muita frequência e o SQLite é single-writer.

const PERSIST_DEBOUNCE_MS = 800

// AAD amarra o auth-state cifrado à SESSÃO certa (não só ao tenant).
function aad(sessionId: string): string {
  return `channel-session:${sessionId}`
}

type StoredKeys = { [type: string]: { [id: string]: unknown } }
type AuthBlob = { creds: AuthenticationCreds; keys: StoredKeys }

// Serialização PURA (testável): BufferJSON preserva os Buffers; depois cifra em repouso.
export function serializeAuthState(
  creds: AuthenticationCreds,
  keys: StoredKeys,
  sessionId: string,
): string {
  const json = JSON.stringify({ creds, keys }, BufferJSON.replacer)
  return encryptSecret(json, aad(sessionId))
}

// Lança se o ciphertext não abrir (ex.: SESSION_SECRET mudou) — o gerente trata
// como 'derrubado' e pede novo QR, em vez de conectar com auth corrompido.
export function deserializeAuthState(enc: string, sessionId: string): AuthBlob {
  const json = decryptSecret(enc, aad(sessionId))
  return JSON.parse(json, BufferJSON.reviver) as AuthBlob
}

// Logger silencioso pro cache do key-store (Baileys espera a interface do pino).
// biome-ignore lint/suspicious/noExplicitAny: stub mínimo do ILogger do pino
const silentLogger: any = {
  level: 'silent',
  child: () => silentLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export type DbAuthState = {
  state: AuthenticationState
  // Persiste o auth-state (debounced) — chamar no evento creds.update.
  saveCreds: () => void
  // Grava AGORA (cancela o debounce) — chamar no shutdown pra não perder o último estado.
  flush: () => Promise<void>
}

/**
 * Provedor de auth-state do Baileys por sessão, cifrado no banco. Server-side.
 * authStateEnc ausente = sessão nova (initAuthCreds); presente mas indecifrável = lança.
 */
export async function useDbAuthState(sessionId: string): Promise<DbAuthState> {
  const row = await db.channelSession.findUnique({
    where: { id: sessionId },
    select: { authStateEnc: true },
  })

  let creds: AuthenticationCreds
  const keys: StoredKeys = {}
  if (row?.authStateEnc) {
    const blob = deserializeAuthState(row.authStateEnc, sessionId)
    creds = blob.creds
    Object.assign(keys, blob.keys)
  } else {
    creds = initAuthCreds()
  }

  // Debounce coalescente: se já há uma gravação agendada, não agenda outra — o
  // flush pendente já captura o estado mais recente (creds/keys são mutados no lugar).
  let timer: ReturnType<typeof setTimeout> | null = null
  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const enc = serializeAuthState(creds, keys, sessionId)
    await db.channelSession.update({ where: { id: sessionId }, data: { authStateEnc: enc } })
  }
  function schedulePersist(): void {
    if (timer) {
      return
    }
    timer = setTimeout(() => {
      timer = null
      void flush().catch((error) =>
        console.error(
          `[baileys-auth] persist falhou (${sessionId}):`,
          error instanceof Error ? error.message : error,
        ),
      )
    }, PERSIST_DEBOUNCE_MS)
  }

  // biome-ignore lint/suspicious/noExplicitAny: assinatura do SignalKeyStore do Baileys
  const store: any = {
    get: (type: keyof SignalDataTypeMap, ids: string[]) => {
      const bucket = keys[type as string] ?? {}
      const out: { [id: string]: unknown } = {}
      for (const id of ids) {
        let value = bucket[id]
        // app-state-sync-key precisa voltar como a mensagem proto (não o objeto cru).
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value as object)
        }
        out[id] = value
      }
      return out
    },
    set: (data: { [type: string]: { [id: string]: unknown } }) => {
      for (const type of Object.keys(data)) {
        keys[type] = keys[type] ?? {}
        for (const id of Object.keys(data[type])) {
          const value = data[type][id]
          if (value) {
            keys[type][id] = value
          } else {
            delete keys[type][id]
          }
        }
      }
      schedulePersist()
    },
  }

  const state: AuthenticationState = {
    creds,
    keys: makeCacheableSignalKeyStore(store, silentLogger),
  }
  return { state, saveCreds: schedulePersist, flush }
}
