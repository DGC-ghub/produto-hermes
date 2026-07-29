import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttendantInput } from '../types'
import { buildPrompt, createConcurrencyGate, parseClaudeJson } from './claude-cli.server'

// O CLI nunca é executado de verdade nos testes: `spawn` é substituído por um
// processo-filho de mentira que o teste controla (quando responde, com o quê).
const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

const input: AttendantInput = {
  tenant: { slug: 'assistencia-tecnica-demo', name: 'ResolveTech' },
  companyRules: ['não prometa preço fechado'],
  knowledge: [{ title: 'Bairros', snippet: 'Atendemos Centro e Jardim América' }],
  history: [{ role: 'user', content: 'oi' }],
  lead: { name: null, phone: null, neighborhood: 'Centro', need: null, urgency: null },
  myTickets: [],
  message: 'minha geladeira parou',
}

describe('buildPrompt', () => {
  it('inclui empresa, regras, base e a mensagem do cliente', () => {
    const prompt = buildPrompt(input)
    expect(prompt).toContain('ResolveTech')
    expect(prompt).toContain('não prometa preço fechado')
    expect(prompt).toContain('Jardim América')
    expect(prompt).toContain('minha geladeira parou')
  })

  it('delimita a mensagem do cliente como dados', () => {
    expect(buildPrompt(input)).toContain('"""minha geladeira parou"""')
  })
})

describe('parseClaudeJson', () => {
  const good =
    '{"reply":"ok","needsHuman":false,"handoffReason":null,"leadPatch":null,"confidence":0.8}'

  it('lê JSON puro', () => {
    expect((parseClaudeJson(good) as { reply: string }).reply).toBe('ok')
  })

  it('lê JSON dentro de cercas markdown', () => {
    const fenced = `\`\`\`json\n${good}\n\`\`\``
    expect((parseClaudeJson(fenced) as { confidence: number }).confidence).toBe(0.8)
  })

  it('ignora texto ao redor do JSON', () => {
    const noisy = `Claro, aqui está:\n${good}\nespero ter ajudado`
    expect((parseClaudeJson(noisy) as { reply: string }).reply).toBe('ok')
  })

  it('lança erro quando não há JSON', () => {
    expect(() => parseClaudeJson('sem json aqui')).toThrow()
  })
})

// ── Semáforo de concorrência ────────────────────────────────────────────────
// O que está sendo provado: uma rajada (a demo pública é o vetor) não vira uma
// pilha de processos `claude` no Pi. Dois rodam, o resto espera na fila, e o que
// não cabe recebe erro — que o dispatcher já transforma em fallback seguro.

/** Deixa as microtasks pendentes rodarem (a vaga é liberada em microtask). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Tarefa que só termina quando o teste mandar. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('createConcurrencyGate', () => {
  it('roda 2 ao mesmo tempo e segura o 3º na fila até abrir vaga', async () => {
    const gate = createConcurrencyGate({ maxConcurrent: 2, maxQueue: 4, waitMs: 1000 })
    const tasks = [deferred(), deferred(), deferred()]
    let started = 0
    const runs = tasks.map((task) =>
      gate.run(async () => {
        started += 1
        await task.promise
      }),
    )

    await flush()
    expect(started).toBe(2)
    expect(gate.stats()).toEqual({ active: 2, queued: 1 })

    tasks[0].resolve()
    await runs[0]
    await flush()
    expect(started).toBe(3)

    tasks[1].resolve()
    tasks[2].resolve()
    await Promise.all(runs)
    expect(gate.stats()).toEqual({ active: 0, queued: 0 })
  })

  it('recusa na hora quando a fila já está cheia (não cresce sem limite)', async () => {
    const gate = createConcurrencyGate({ maxConcurrent: 1, maxQueue: 1, waitMs: 5000 })
    const running = deferred()
    const queued = deferred()
    const first = gate.run(() => running.promise)
    const second = gate.run(() => queued.promise)
    const excess = vi.fn(async () => 'nunca roda')

    await expect(gate.run(excess)).rejects.toThrow(/fila do claude cheia/)
    expect(excess).not.toHaveBeenCalled()

    running.resolve()
    queued.resolve()
    await Promise.all([first, second])
  })

  it('desiste com erro quando a espera passa do teto (nunca trava)', async () => {
    const gate = createConcurrencyGate({ maxConcurrent: 1, maxQueue: 2, waitMs: 20 })
    const running = deferred()
    const first = gate.run(() => running.promise)

    await expect(gate.run(async () => 'tarde demais')).rejects.toThrow(/espera na fila do claude/)
    expect(gate.stats().queued).toBe(0)

    running.resolve()
    await first
  })
})

describe('claudeCliProvider sob concorrência', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    spawnMock.mockReset()
  })

  type FakeChild = EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    stdin: { write: () => void; end: () => void }
  }

  /** Processo-filho de mentira: o teste decide quando ele responde e fecha. */
  function fakeChild(): FakeChild {
    const child = new EventEmitter() as FakeChild
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { write: () => undefined, end: () => undefined }
    return child
  }

  const REPLY =
    '{"reply":"ok","needsHuman":false,"handoffReason":null,"leadPatch":null,"confidence":0.9,"action":null}'

  function finish(child: FakeChild) {
    child.stdout.emit('data', Buffer.from(REPLY))
    child.emit('close', 0)
  }

  it('mantém no máximo 2 processos vivos, enfileira o 3º e degrada o excedente', async () => {
    vi.stubEnv('ATTENDANT_MAX_CONCURRENT', '2')
    vi.stubEnv('ATTENDANT_QUEUE_MAX', '1')
    vi.stubEnv('ATTENDANT_QUEUE_WAIT_MS', '2000')
    vi.resetModules()
    const { claudeCliProvider } = await import('./claude-cli.server')

    const children: FakeChild[] = []
    spawnMock.mockImplementation(() => {
      const child = fakeChild()
      children.push(child)
      return child
    })

    const first = claudeCliProvider.generate(input)
    const second = claudeCliProvider.generate(input)
    const third = claudeCliProvider.generate(input) // espera na fila
    const excess = claudeCliProvider.generate(input) // fila cheia → recusa na hora

    // O excedente falha igual a uma falha do CLI (o dispatcher escala p/ humano).
    await expect(excess).rejects.toThrow(/fila do claude cheia/)
    await flush()
    expect(children).toHaveLength(2)

    finish(children[0])
    await expect(first).resolves.toMatchObject({ reply: 'ok' })
    await flush()
    // A vaga que abriu foi para quem estava na fila.
    expect(children).toHaveLength(3)

    finish(children[1])
    finish(children[2])
    await expect(second).resolves.toMatchObject({ reply: 'ok' })
    await expect(third).resolves.toMatchObject({ reply: 'ok' })
  })
})
