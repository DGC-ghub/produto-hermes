import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { action as esqueciSenhaAction } from '../routes/esqueci-senha'
import { hashPassword, verifyPassword } from './operators.server'
import {
  accountForResetToken,
  checkResetToken,
  completePasswordReset,
  INVALID_TOKEN_ERROR,
  issueResetToken,
  startPasswordReset,
} from './password-reset.server'

const EMAIL = 'zzz-reset@teste.local'
const SENHA_ANTIGA = 'senha-antiga-123'
const SENHA_NOVA = 'senha-nova-456'
const UMA_HORA_MS = 60 * 60 * 1000

afterEach(async () => {
  await db.account.deleteMany({ where: { email: EMAIL } })
})

async function makeAccount() {
  return db.account.create({
    data: { email: EMAIL, passwordHash: await hashPassword(SENHA_ANTIGA) },
  })
}

/** Reescreve o payload do token mantendo a assinatura antiga (ataque de adulteração). */
function tamperPayload(token: string, mutate: (payload: string) => string): string {
  const [encoded, signature] = token.split('.')
  const payload = Buffer.from(String(encoded), 'base64url').toString('utf8')
  return `${Buffer.from(mutate(payload), 'utf8').toString('base64url')}.${signature}`
}

describe('token de redefinição de senha', () => {
  it('token recém-emitido vale para a conta que o pediu', async () => {
    const acc = await makeAccount()
    const token = issueResetToken(acc)
    expect(await accountForResetToken(token)).toEqual({ id: acc.id, email: EMAIL })
  })

  it('token expirado não vale', async () => {
    const acc = await makeAccount()
    // Emitido duas horas atrás: o prazo (1h) viaja dentro do payload assinado.
    const token = issueResetToken(acc, Date.now() - 2 * UMA_HORA_MS)
    expect(await accountForResetToken(token)).toBeNull()
    expect(
      await completePasswordReset({ token, password: SENHA_NOVA, confirmation: SENHA_NOVA }),
    ).toEqual({ ok: false, error: INVALID_TOKEN_ERROR })
  })

  it('assinatura adulterada não vale', async () => {
    const acc = await makeAccount()
    const token = issueResetToken(acc)
    const [encoded, signature] = token.split('.')
    const trocado = `${signature?.slice(0, -1)}${signature?.endsWith('A') ? 'B' : 'A'}`
    expect(await accountForResetToken(`${encoded}.${trocado}`)).toBeNull()
    expect(await accountForResetToken(`${encoded}.`)).toBeNull()
    expect(await accountForResetToken('lixo')).toBeNull()
  })

  it('prazo esticado no payload não vale — a assinatura cobre a data', async () => {
    const acc = await makeAccount()
    const token = issueResetToken(acc, Date.now() - 2 * UMA_HORA_MS)
    const esticado = tamperPayload(token, () => `${acc.id}:${Date.now() + 365 * 24 * UMA_HORA_MS}`)
    expect(await accountForResetToken(esticado)).toBeNull()
  })

  it('token de uma conta não serve para outra', async () => {
    const acc = await makeAccount()
    const token = issueResetToken(acc)
    const doVizinho = tamperPayload(token, (payload) => payload.replace(acc.id, 'outra-conta'))
    expect(await accountForResetToken(doVizinho)).toBeNull()
  })

  it('deixa de valer quando o hash da senha muda — uso único sem guardar estado', () => {
    const token = issueResetToken({ id: 'conta-1', passwordHash: 'sal:hash-antigo' })
    expect(checkResetToken(token, 'sal:hash-antigo')).not.toBeNull()
    expect(checkResetToken(token, 'sal:hash-novo')).toBeNull()
  })
})

describe('redefinição de senha ponta a ponta', () => {
  it('grava o hash novo com o mesmo algoritmo do login', async () => {
    const acc = await makeAccount()
    const token = issueResetToken(acc)

    const result = await completePasswordReset({
      token,
      password: SENHA_NOVA,
      confirmation: SENHA_NOVA,
    })

    expect(result).toEqual({ ok: true, email: EMAIL })
    const atualizada = await db.account.findUnique({ where: { id: acc.id } })
    expect(await verifyPassword(SENHA_NOVA, String(atualizada?.passwordHash))).toBe(true)
    expect(await verifyPassword(SENHA_ANTIGA, String(atualizada?.passwordHash))).toBe(false)
  })

  it('o link usado uma vez não redefine de novo', async () => {
    const acc = await makeAccount()
    const token = issueResetToken(acc)
    await completePasswordReset({ token, password: SENHA_NOVA, confirmation: SENHA_NOVA })

    const segunda = await completePasswordReset({
      token,
      password: 'terceira-senha-789',
      confirmation: 'terceira-senha-789',
    })

    expect(segunda).toEqual({ ok: false, error: INVALID_TOKEN_ERROR })
    // E a senha continua a que a pessoa escolheu no primeiro uso.
    const atualizada = await db.account.findUnique({ where: { id: acc.id } })
    expect(await verifyPassword(SENHA_NOVA, String(atualizada?.passwordHash))).toBe(true)
  })

  it('recusa senha curta e senhas que não conferem', async () => {
    const acc = await makeAccount()
    const token = issueResetToken(acc)
    expect(await completePasswordReset({ token, password: '1234', confirmation: '1234' })).toEqual({
      ok: false,
      error: 'A senha precisa de ao menos 8 caracteres.',
    })
    expect(
      await completePasswordReset({ token, password: SENHA_NOVA, confirmation: 'outra-coisa-1' }),
    ).toEqual({ ok: false, error: 'As senhas não conferem.' })
  })

  it('startPasswordReset só dispara e-mail para conta existente (mas a rota não conta isso)', async () => {
    const acc = await makeAccount()
    expect(await startPasswordReset(acc.email.toUpperCase(), 'https://x.test/')).toBe(true)
    expect(await startPasswordReset('nao-existe@teste.local', 'https://x.test')).toBe(false)
  })
})

describe('/esqueci-senha — sem enumeração de contas', () => {
  /** A resposta do action para um e-mail qualquer. */
  async function pedir(email: string) {
    const form = new FormData()
    form.set('email', email)
    const request = new Request('http://localhost/esqueci-senha', { method: 'POST', body: form })
    return esqueciSenhaAction({ request } as never)
  }

  it('responde exatamente a mesma coisa para e-mail que existe e que não existe', async () => {
    await makeAccount()
    const existente = await pedir(EMAIL)
    const inexistente = await pedir('ninguem-mesmo@teste.local')
    expect(existente).toEqual(inexistente)
    expect(existente).toMatchObject({ ok: true })
  })

  it('responde igual mesmo depois de estourar o teto por e-mail (o limite também não vaza)', async () => {
    await makeAccount()
    const primeira = await pedir(EMAIL)
    for (let i = 0; i < 5; i++) {
      await pedir(EMAIL)
    }
    expect(await pedir(EMAIL)).toEqual(primeira)
  })
})
