import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TransbordoConfig } from './attendant/tenant-config'
import { montarTransbordo, ocultarDadosPessoais, registrarTransbordo } from './transbordo.server'

const config: TransbordoConfig = {
  enabled: true,
  recomendacoes: [
    { triggers: ['desconto'], resposta: 'Explicar que o preço do piloto é fixo.' },
    { triggers: ['termo', 'prazo de guarda'], resposta: 'Dizer que o termo está com o advogado.' },
  ],
  respostaPadrao: 'Ler a conversa e responder direto.',
}

const historico = [
  { role: 'user' as const, content: 'Oi, quero saber do piloto' },
  { role: 'assistant' as const, content: 'Olá! Sou a assistente da DGC Hub.' },
]

describe('ocultarDadosPessoais', () => {
  it('tapa CPF, telefone e e-mail', () => {
    const texto = ocultarDadosPessoais(
      'CPF 123.456.789-09, fone (11) 98888-7777, mail joao@x.com.br',
    )
    expect(texto).not.toMatch(/123\.456|98888|joao@/)
    expect(texto).toContain('[oculto]')
  })

  it('não mexe em texto normal nem em valor em reais', () => {
    expect(ocultarDadosPessoais('Faz por R$ 500 ou 3 vezes?')).toBe('Faz por R$ 500 ou 3 vezes?')
  })
})

describe('montarTransbordo', () => {
  it('escolhe a recomendação pelo tema da mensagem', () => {
    const t = montarTransbordo({
      config,
      tenantSlug: 'dgc-vendas',
      conversationId: 'c1',
      motivo: 'sensitive_topic',
      mensagem: 'Faz um desconto?',
      historico,
      agora: new Date('2026-11-24T12:00:00Z'),
    })
    expect(t.respostaRecomendada).toBe('Explicar que o preço do piloto é fixo.')
    expect(t.motivo).toBe('sensitive_topic')
    expect(t.resumo).toContain('Faz um desconto?')
    expect(t.criadoEm).toBe('2026-11-24T12:00:00.000Z')
  })

  it('sem tema conhecido usa a resposta padrão', () => {
    const t = montarTransbordo({
      config,
      tenantSlug: 'dgc-vendas',
      conversationId: 'c1',
      motivo: 'no_knowledge_match',
      mensagem: 'Vocês integram com o sistema X?',
      historico,
    })
    expect(t.respostaRecomendada).toBe('Ler a conversa e responder direto.')
  })

  it('o resumo não carrega dado pessoal', () => {
    const t = montarTransbordo({
      config,
      tenantSlug: 'dgc-vendas',
      conversationId: 'c1',
      motivo: 'sensitive_topic',
      mensagem: 'meu CPF é 123.456.789-09',
      historico,
    })
    expect(JSON.stringify(t)).not.toContain('123.456.789-09')
  })
})

describe('registrarTransbordo', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('acrescenta uma linha JSON por transbordo no arquivo do tenant', async () => {
    dir = mkdtempSync(join(tmpdir(), 'transbordo-'))
    const base = {
      config,
      tenantSlug: 'dgc-vendas',
      conversationId: 'c1',
      motivo: 'sensitive_topic',
      mensagem: 'desconto?',
      historico,
      diretorio: dir,
    }
    await registrarTransbordo(base)
    await registrarTransbordo({ ...base, conversationId: 'c2' })
    const linhas = readFileSync(join(dir, 'dgc-vendas.jsonl'), 'utf8').trim().split('\n')
    expect(linhas).toHaveLength(2)
    expect(JSON.parse(linhas[1] as string).conversationId).toBe('c2')
  })

  it('config desligada não grava nada', async () => {
    dir = mkdtempSync(join(tmpdir(), 'transbordo-'))
    await registrarTransbordo({
      config: { ...config, enabled: false },
      tenantSlug: 'dgc-vendas',
      conversationId: 'c1',
      motivo: 'x',
      mensagem: 'oi',
      historico,
      diretorio: dir,
    })
    expect(() => readFileSync(join(dir, 'dgc-vendas.jsonl'), 'utf8')).toThrow()
  })

  it('slug inseguro é recusado (sem escrever fora da pasta)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'transbordo-'))
    await expect(
      registrarTransbordo({
        config,
        tenantSlug: '../x',
        conversationId: 'c1',
        motivo: 'x',
        mensagem: 'oi',
        historico,
        diretorio: dir,
      }),
    ).rejects.toThrow()
  })
})
