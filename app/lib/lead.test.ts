import { describe, expect, it } from 'vitest'
import { extractLeadPatch } from './lead'

describe('extractLeadPatch', () => {
  it('detects high urgency from each urgency term', () => {
    const terms = [
      'hoje',
      'agora',
      'urgente',
      'parou',
      'não funciona',
      'nao funciona',
      'sem funcionar',
    ]
    for (const term of terms) {
      expect(extractLeadPatch(`Meu problema ${term} aqui`).urgency).toBe('alta')
    }
  })

  it('returns no urgency when there is no urgency term', () => {
    expect(extractLeadPatch('Gostaria de um orçamento tranquilo').urgency).toBeUndefined()
  })

  it('detects Jardim América with and without accent', () => {
    expect(extractLeadPatch('moro no Jardim América').neighborhood).toBe('Jardim América')
    expect(extractLeadPatch('moro no Jardim America').neighborhood).toBe('Jardim América')
  })

  it('detects other known neighborhoods', () => {
    expect(extractLeadPatch('sou do Centro').neighborhood).toBe('Centro')
    expect(extractLeadPatch('estou na Vila Nova').neighborhood).toBe('Vila Nova')
    expect(extractLeadPatch('aqui na Bela Vista').neighborhood).toBe('Bela Vista')
  })

  it('builds need from the compacted message', () => {
    expect(extractLeadPatch('  Minha   geladeira   parou  ').need).toBe('Minha geladeira parou')
  })

  it('truncates need to 180 characters', () => {
    const long = 'a'.repeat(300)
    expect(extractLeadPatch(long).need?.length).toBe(180)
  })

  it('does not invent a neighborhood when none is present', () => {
    expect(extractLeadPatch('Preciso de ajuda com meu equipamento').neighborhood).toBeUndefined()
  })

  it('returns an empty patch for an empty message', () => {
    expect(extractLeadPatch('   ')).toEqual({})
  })

  it('does not extract phone or name', () => {
    const patch = extractLeadPatch('Meu nome é João, telefone 11999998888, geladeira parou')
    expect(patch).not.toHaveProperty('name')
    expect(patch).not.toHaveProperty('phone')
  })
})
