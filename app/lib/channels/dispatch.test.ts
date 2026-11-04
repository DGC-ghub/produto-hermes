import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mocka o transporte Meta: o dispatcher não deve carregar o whatsapp.server real
// (banco/cifra) — só provar que despacha pro canal certo com os args certos.
vi.mock('../whatsapp.server', () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ status: 'sent', providerMessageId: 'wamid.x' })),
}))

import { sendWhatsAppMessage } from '../whatsapp.server'
import { sendReply } from './dispatch.server'
import { metaRef } from './types'

describe('sendReply', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('canal meta chama sendWhatsAppMessage com (to, text, phoneNumberId)', async () => {
    const r = await sendReply(metaRef('123'), '5511999', 'oi')
    expect(r.status).toBe('sent')
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('5511999', 'oi', '123')
  })

  it('meta sem número passa undefined (o fallback pro env fica no sendWhatsAppMessage)', async () => {
    await sendReply(metaRef(), 'to', 'x')
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('to', 'x', undefined)
  })

  it('canal baileys não toca na Meta — e sessão inexistente é NÃO ENVIADO definitivo', async () => {
    // `not_sent` e não `ambiguous`: sem sessão nada chegou a sair, então reenviar depois é
    // seguro. A distinção existe justamente para não pedir olho humano onde não é preciso.
    const r = await sendReply({ kind: 'baileys', sessionId: 's1' }, 'to', 'x')
    expect(r.status).toBe('not_sent')
    expect(r.status === 'not_sent' && r.retryable).toBe(false)
    expect(sendWhatsAppMessage).not.toHaveBeenCalled()
  })

  it('metaRef monta o ref do canal oficial', () => {
    expect(metaRef('999')).toEqual({ kind: 'meta', phoneNumberId: '999' })
    expect(metaRef()).toEqual({ kind: 'meta', phoneNumberId: undefined })
  })
})
