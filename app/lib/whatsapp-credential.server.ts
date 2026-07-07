import { db } from '../db.server'
import { decryptSecret, encryptSecret } from './crypto.server'

// Credenciais de WhatsApp POR TENANT (marco M4.2). Hoje o canal usa um único token
// global (env) — o que impede um 2º cliente de enviar pelo próprio número. Aqui a
// credencial passa a vir do BANCO (cifrada em repouso, AAD `tenant:<id>`), com o env
// como fallback de transição (estratégia C, igual ao config/knowledge). Server-side.

export type WhatsappCredential = {
  accessToken: string | null // token de envio da Cloud API
  appSecret: string | null // App Secret p/ validar a assinatura do webhook
}

// Decifra tolerante a falha: se a credencial cifrada não abre (SESSION_SECRET mudou,
// corrupção, contexto errado), NÃO cai no env global às cegas — loga e devolve null,
// pra não enviar com uma credencial que não corresponde ao número. Fail-safe.
function tryDecrypt(enc: string, context: string, label: string): string | null {
  try {
    return decryptSecret(enc, context)
  } catch (error) {
    console.error(
      `[whatsapp] falha ao decifrar ${label} (SESSION_SECRET mudou?):`,
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/**
 * Resolve as credenciais de um número (phone_number_id): primeiro no BANCO
 * (`WhatsappNumber.accessTokenEnc`/`appSecretEnc`, decifradas com AAD `tenant:<id>`)
 * e, quando o campo está vazio ou o número não é registrado, no ENV global como
 * fallback de transição. Assim os pilotos seguem no env e um cliente novo pode ter
 * credencial própria sem redeploy. Server-side (usa `db`).
 */
export async function resolveWhatsappCredential(
  phoneNumberId: string,
): Promise<WhatsappCredential> {
  const envToken = process.env.WHATSAPP_ACCESS_TOKEN ?? null
  const envSecret = process.env.WHATSAPP_APP_SECRET ?? null

  const row = await db.whatsappNumber.findUnique({
    where: { phoneNumberId },
    select: { tenantId: true, accessTokenEnc: true, appSecretEnc: true },
  })
  if (!row) {
    return { accessToken: envToken, appSecret: envSecret }
  }

  const context = `tenant:${row.tenantId}`
  return {
    accessToken: row.accessTokenEnc
      ? tryDecrypt(row.accessTokenEnc, context, 'access token')
      : envToken,
    appSecret: row.appSecretEnc ? tryDecrypt(row.appSecretEnc, context, 'app secret') : envSecret,
  }
}

/**
 * Grava (cifradas) as credenciais próprias de um número JÁ registrado — é o que o
 * onboarding de WhatsApp do cliente chama após conectar a conta Meta. Cifra com AAD
 * `tenant:<id>`. `undefined` mantém o valor atual; `null` limpa (volta pro env).
 * Server-side (usa `db` + crypto.server).
 */
export async function setWhatsappCredential(
  phoneNumberId: string,
  creds: { accessToken?: string | null; appSecret?: string | null },
): Promise<void> {
  const row = await db.whatsappNumber.findUnique({
    where: { phoneNumberId },
    select: { tenantId: true },
  })
  if (!row) {
    throw new Error(`Número de WhatsApp não registrado: ${phoneNumberId}`)
  }
  const context = `tenant:${row.tenantId}`
  const data: { accessTokenEnc?: string | null; appSecretEnc?: string | null } = {}
  if (creds.accessToken !== undefined) {
    data.accessTokenEnc =
      creds.accessToken === null ? null : encryptSecret(creds.accessToken, context)
  }
  if (creds.appSecret !== undefined) {
    data.appSecretEnc = creds.appSecret === null ? null : encryptSecret(creds.appSecret, context)
  }
  await db.whatsappNumber.update({ where: { phoneNumberId }, data })
}
