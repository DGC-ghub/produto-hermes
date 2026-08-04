import { describe, expect, it } from 'vitest'
import { nomeDoBancoDoWorker, TEST_DB_PREFIX } from './vitest.worker-db'

// Um worker que cai no banco de outro traz de volta exatamente o problema que o banco por
// worker resolve — e o sintoma aparece longe daqui, como timeout intermitente em quem
// escreve muito. Por isso a regra do nome tem teste próprio.

describe('nome do banco por worker', () => {
  it('processos diferentes, bancos diferentes (pool `forks`, o default)', () => {
    // Em forks o `threadId` é 0 em todos; quem distingue é o pid.
    expect(nomeDoBancoDoWorker(100, 0)).not.toBe(nomeDoBancoDoWorker(101, 0))
  })

  it('threads do MESMO processo, bancos diferentes (pool `threads`)', () => {
    // Aqui o pid é igual para todos. Só com o pid, todas as threads voltavam ao mesmo
    // arquivo SQLite.
    expect(nomeDoBancoDoWorker(100, 1)).not.toBe(nomeDoBancoDoWorker(100, 2))
  })

  it('o mesmo worker sempre recebe o mesmo banco', () => {
    // Nome instável faria cada arquivo de teste começar num banco vazio.
    expect(nomeDoBancoDoWorker(100, 3)).toBe(nomeDoBancoDoWorker(100, 3))
  })

  it('leva o prefixo que o teardown apaga', () => {
    // Sem o prefixo o arquivo sobrevive à suíte e vira lixo no repo.
    expect(nomeDoBancoDoWorker(100, 0).startsWith(TEST_DB_PREFIX)).toBe(true)
    expect(nomeDoBancoDoWorker(100, 0).endsWith('.db')).toBe(true)
  })

  it('não colide com o molde', () => {
    // O molde é `.test-template.db`: se um worker caísse nele, os testes escreveriam no
    // arquivo que serve de base para todos os outros.
    expect(nomeDoBancoDoWorker(100, 0)).not.toBe('.test-template.db')
  })
})
