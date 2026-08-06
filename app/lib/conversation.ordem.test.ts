import { beforeEach, describe, expect, it, vi } from 'vitest'

// A ORDEM DO FAIL-CLOSED: entrada inválida não TOCA em nada.
//
// Os testes de `conversation.modo.test.ts` provam que nenhum REGISTRO sobrou. É menos do que
// a promessa: "recusar antes de tudo" também quer dizer sem resolver tenant, sem consultar
// conversa e sem tentar gravar métrica. Uma implementação que validasse depois de resolver o
// tenant deixaria os mesmos zero registros e passaria por lá.
//
// Aqui todas as bordas são espiãs, então a prova é por CHAMADA, não por resíduo.

const espioes = vi.hoisted(() => ({
  resolveTenant: vi.fn(),
  conversationFindUnique: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationCreate: vi.fn(),
  conversationUpdateMany: vi.fn(),
  messageCreate: vi.fn(),
  recordMessageTrace: vi.fn(),
  cerebro: vi.fn(),
  alarme: vi.fn(),
}))

vi.mock('./tenants.server', () => ({
  resolveTenant: espioes.resolveTenant,
  DEMO_TENANT_SLUGS: [],
  INITIAL_TENANTS: [],
  ensureInitialTenants: vi.fn(),
}))

vi.mock('../db.server', () => ({
  db: {
    conversation: {
      findUnique: espioes.conversationFindUnique,
      findFirst: espioes.conversationFindFirst,
      create: espioes.conversationCreate,
      updateMany: espioes.conversationUpdateMany,
      update: vi.fn(),
    },
    message: { create: espioes.messageCreate, findMany: vi.fn(async () => []) },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
    ticket: { findMany: vi.fn(async () => []), create: vi.fn() },
    handoffEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('./metrics.server', () => ({
  recordMessageTrace: espioes.recordMessageTrace,
}))

vi.mock('./attendant', () => ({
  generateAttendantReply: espioes.cerebro,
  activeProviderName: () => 'mock',
}))

vi.mock('./alarm.server', () => ({
  reportDegradation: espioes.alarme,
  reportSensitiveHandoff: espioes.alarme,
}))

const { processIncomingMessage } = await import('./conversation.server')

beforeEach(() => {
  vi.clearAllMocks()
})

/** Nenhuma borda foi tocada. */
function nadaFoiTocado() {
  expect(espioes.resolveTenant).not.toHaveBeenCalled()
  expect(espioes.conversationFindUnique).not.toHaveBeenCalled()
  expect(espioes.conversationFindFirst).not.toHaveBeenCalled()
  expect(espioes.conversationCreate).not.toHaveBeenCalled()
  expect(espioes.conversationUpdateMany).not.toHaveBeenCalled()
  expect(espioes.messageCreate).not.toHaveBeenCalled()
  expect(espioes.recordMessageTrace).not.toHaveBeenCalled()
  expect(espioes.cerebro).not.toHaveBeenCalled()
  expect(espioes.alarme).not.toHaveBeenCalled()
}

const CASOS: Array<[string, Record<string, unknown>, string]> = [
  [
    'modo inexistente',
    { tenantSlug: 'dgc', contactId: 'c', message: 'oi', mode: 'inventado' },
    'Invalid execution mode',
  ],
  [
    'chave herdada como modo',
    { tenantSlug: 'dgc', contactId: 'c', message: 'oi', mode: 'constructor' },
    'Invalid execution mode',
  ],
  [
    'snapshot fora de owner_preview',
    {
      tenantSlug: 'dgc',
      contactId: 'c',
      message: 'oi',
      mode: 'whatsapp',
      previewSnapshot: { config: {}, conhecimento: [] },
    },
    'Preview snapshot requires owner preview mode',
  ],
  [
    'contato ausente',
    { tenantSlug: 'dgc', message: 'oi', mode: 'whatsapp' },
    'Contact identity is required',
  ],
  [
    'contato vazio',
    { tenantSlug: 'dgc', contactId: '  ', message: 'oi', mode: 'whatsapp' },
    'Contact identity is required',
  ],
]

describe('entrada inválida não resolve tenant, não lê conversa e não tenta trace', () => {
  it.each(CASOS)('%s', async (_rotulo, entrada, mensagem) => {
    await expect(
      processIncomingMessage(entrada as unknown as Parameters<typeof processIncomingMessage>[0]),
    ).rejects.toThrow(mensagem)

    nadaFoiTocado()
  })

  it('o par positivo: entrada válida CHEGA a resolver o tenant', async () => {
    // Sem este, uma validação que recusasse tudo passaria em todos os casos acima.
    espioes.resolveTenant.mockResolvedValueOnce(null)

    await expect(
      processIncomingMessage({
        tenantSlug: 'dgc',
        contactId: 'c',
        message: 'oi',
        mode: 'whatsapp',
      }),
    ).rejects.toThrow('Unknown tenant')

    expect(espioes.resolveTenant).toHaveBeenCalledTimes(1)
  })
})
