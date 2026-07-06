import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendEmail } from './email.server'

afterEach(() => vi.unstubAllEnvs())

describe('sendEmail (M2.6)', () => {
  it('sem RESEND_API_KEY → modo stub, não envia (sent:false)', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const r = await sendEmail({ to: 'x@y.local', subject: 'oi', html: '<p>oi</p>' })
    expect(r.sent).toBe(false)
  })
})
