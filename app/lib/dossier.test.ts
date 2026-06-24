import { describe, expect, it } from 'vitest'
import { type ComposeDossierInput, composeDossier } from './dossier.server'

function baseInput(overrides: Partial<ComposeDossierInput> = {}): ComposeDossierInput {
  return {
    contactId: 'c-1',
    tenantSlug: 'dgc',
    tenantName: 'DGC Hub',
    status: 'open',
    handoffReason: null,
    lead: null,
    tickets: [],
    recentMessages: [],
    ...overrides,
  }
}

const lead = (over: Partial<NonNullable<ComposeDossierInput['lead']>> = {}) => ({
  name: 'Marta Souza',
  phone: '11 98888-7777',
  neighborhood: 'Jardim América',
  need: 'Geladeira parada',
  urgency: null,
  stage: 'novo',
  ...over,
})

describe('composeDossier', () => {
  it('marks priority alta when the lead is urgent', () => {
    const d = composeDossier(baseInput({ lead: lead({ urgency: 'alta' }) }))
    expect(d.priority).toBe('alta')
    expect(d.headline).toContain('⚠ urgente')
  })

  it('marks priority alta when the handoff reason is a human request', () => {
    const d = composeDossier(baseInput({ handoffReason: 'requested_human' }))
    expect(d.priority).toBe('alta')
  })

  it('marks priority alta for sensitive topics', () => {
    const d = composeDossier(baseInput({ handoffReason: 'sensitive_topic' }))
    expect(d.priority).toBe('alta')
  })

  it('marks priority media when there is a lead but no urgency', () => {
    const d = composeDossier(baseInput({ lead: lead() }))
    expect(d.priority).toBe('media')
  })

  it('marks priority media when there is an open ticket but no lead', () => {
    const d = composeDossier(
      baseInput({
        tickets: [{ subject: 'Geladeira', status: 'aberto', category: null, createdAt: '' }],
      }),
    )
    expect(d.priority).toBe('media')
    expect(d.openTicketCount).toBe(1)
  })

  it('marks priority baixa when there is nothing relevant', () => {
    const d = composeDossier(baseInput())
    expect(d.priority).toBe('baixa')
  })

  it('counts only open/in-progress tickets as open', () => {
    const d = composeDossier(
      baseInput({
        tickets: [
          { subject: 'A', status: 'aberto', category: null, createdAt: '' },
          { subject: 'B', status: 'em_andamento', category: null, createdAt: '' },
          { subject: 'C', status: 'resolvido', category: null, createdAt: '' },
        ],
      }),
    )
    expect(d.openTicketCount).toBe(2)
  })

  it('builds a headline from the available fields, skipping the empty ones', () => {
    const d = composeDossier(
      baseInput({
        lead: lead({ urgency: 'alta' }),
        tickets: [{ subject: 'X', status: 'aberto', category: null, createdAt: '' }],
      }),
    )
    expect(d.headline).toBe(
      'Marta Souza · Jardim América · Geladeira parada · ⚠ urgente · 1 chamado aberto',
    )
  })

  it('falls back to the contactId when there is no name', () => {
    const d = composeDossier(baseInput({ contactId: '5511999' }))
    expect(d.headline).toContain('Contato 5511999')
  })

  it('pluralizes the open-ticket count', () => {
    const d = composeDossier(
      baseInput({
        tickets: [
          { subject: 'A', status: 'aberto', category: null, createdAt: '' },
          { subject: 'B', status: 'aberto', category: null, createdAt: '' },
        ],
      }),
    )
    expect(d.headline).toContain('2 chamados abertos')
  })
})
