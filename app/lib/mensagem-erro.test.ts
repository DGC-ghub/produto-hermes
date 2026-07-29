import { describe, expect, it } from 'vitest'
import { mensagemAmigavel } from './mensagem-erro'

const FALLBACK = 'Não conseguimos salvar agora. Tente de novo em instantes.'

describe('mensagemAmigavel — validação de config/campo obrigatório', () => {
  it('traduz o caminho do campo pelo nome que a tela usa', () => {
    // Erro real que já apareceu pro cliente na tela /configuracoes.
    expect(
      mensagemAmigavel(
        new Error('TenantConfig.businessProfile.tone deve ser uma string não-vazia'),
      ),
    ).toBe('Preencha o campo "Tom de voz" antes de salvar.')
    expect(
      mensagemAmigavel(
        new Error('TenantConfig.escalationPolicy.humanMessage deve ser uma string não-vazia'),
      ),
    ).toBe('Preencha o campo "Mensagem ao cliente ao escalar" antes de salvar.')
  })

  it('erro de seção inteira aponta a seção, não um campo', () => {
    expect(mensagemAmigavel(new Error('TenantConfig.businessProfile deve ser um objeto'))).toBe(
      'Confira a seção "Perfil da empresa" — faltou uma informação obrigatória.',
    )
  })

  it('campo do config sem rótulo conhecido cai no genérico de formulário', () => {
    expect(mensagemAmigavel(new Error('TenantConfig.root deve ser um objeto'))).toBe(
      'Faltou preencher um campo obrigatório. Confira o formulário e salve de novo.',
    )
  })

  it('validação fora do TenantConfig (documento sem título/conteúdo)', () => {
    expect(
      mensagemAmigavel(new Error('Documento de conhecimento precisa de título e conteúdo.')),
    ).toBe('Faltou preencher um campo obrigatório. Confira o formulário e salve de novo.')
  })
})

describe('mensagemAmigavel — variável de ambiente ausente', () => {
  it('não manda o dono preencher formulário nenhum; manda avisar o suporte', () => {
    const esperado =
      'Falta uma configuração do sistema para concluir isso. Já registramos o erro — avise o suporte se continuar acontecendo.'
    expect(
      mensagemAmigavel(
        new Error('SESSION_SECRET é obrigatório em produção (assina o cookie do operador).'),
      ),
    ).toBe(esperado)
    expect(mensagemAmigavel(new Error('Environment variable not found: DATABASE_URL'))).toBe(
      esperado,
    )
  })
})

describe('mensagemAmigavel — falha de conexão', () => {
  const esperado =
    'Não conseguimos falar com o servidor agora. Confira sua conexão e tente de novo em instantes.'

  it('reconhece pelo código do Node', () => {
    expect(mensagemAmigavel(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }))).toBe(
      esperado,
    )
  })

  it('reconhece o código embutido na mensagem, quando o erro foi reembrulhado', () => {
    expect(mensagemAmigavel(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(esperado)
  })

  it('reconhece o motivo escondido na causa do fetch', () => {
    const erro = new Error('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.zap') })
    expect(mensagemAmigavel(erro)).toBe(esperado)
  })
})

describe('mensagemAmigavel — registro não encontrado', () => {
  const esperado =
    'Não encontramos esse item — ele pode ter sido removido. Atualize a página e tente de novo.'

  it('pela mensagem do nosso código', () => {
    expect(mensagemAmigavel(new Error('Documento não encontrado neste tenant.'))).toBe(esperado)
  })

  it('pelo código P2025 do Prisma', () => {
    expect(
      mensagemAmigavel(Object.assign(new Error('Record to update not found.'), { code: 'P2025' })),
    ).toBe(esperado)
  })
})

describe('mensagemAmigavel — erro do Prisma', () => {
  it('P2002 (duplicado) diz o que mudar', () => {
    expect(
      mensagemAmigavel(
        Object.assign(new Error('Unique constraint failed on the fields: (`slug`)'), {
          code: 'P2002',
        }),
      ),
    ).toBe('Já existe um registro com essas informações. Mude o que está repetido e salve de novo.')
  })

  it('P1001 (banco inalcançável) vira falha temporária, não erro de preenchimento', () => {
    expect(
      mensagemAmigavel(
        Object.assign(new Error("Can't reach database server at `localhost:5432`"), {
          code: 'P1001',
        }),
      ),
    ).toBe(
      'Nossa base de dados não respondeu agora. Tente de novo em instantes; se continuar, avise o suporte.',
    )
  })

  it('código do Prisma desconhecido cai no genérico de banco', () => {
    expect(mensagemAmigavel(Object.assign(new Error('boom'), { code: 'P2999' }))).toBe(
      'Nossa base de dados não respondeu agora. Tente de novo em instantes; se continuar, avise o suporte.',
    )
  })
})

describe('mensagemAmigavel — fallback genérico', () => {
  it('erro desconhecido, string solta, null e objeto estranho', () => {
    expect(mensagemAmigavel(new Error('Cannot read properties of undefined (reading foo)'))).toBe(
      FALLBACK,
    )
    expect(mensagemAmigavel('deu ruim')).toBe(FALLBACK)
    expect(mensagemAmigavel(null)).toBe(FALLBACK)
    expect(mensagemAmigavel(undefined)).toBe(FALLBACK)
    expect(mensagemAmigavel({ qualquer: 'coisa' })).toBe(FALLBACK)
  })

  it('nunca repassa o texto técnico cru para a tela', () => {
    const crus = [
      'TenantConfig.businessProfile.tone deve ser uma string não-vazia',
      'SESSION_SECRET é obrigatório em produção',
      'Invalid `prisma.tenant.create()` invocation',
      'ECONNREFUSED 127.0.0.1:5432',
      'TypeError: undefined is not a function',
    ]
    for (const cru of crus) {
      const saida = mensagemAmigavel(new Error(cru))
      expect(saida).not.toContain('TenantConfig')
      expect(saida).not.toContain('SESSION_SECRET')
      expect(saida).not.toContain('prisma')
      expect(saida).not.toContain('ECONNREFUSED')
      expect(saida).not.toContain('TypeError')
    }
  })
})
