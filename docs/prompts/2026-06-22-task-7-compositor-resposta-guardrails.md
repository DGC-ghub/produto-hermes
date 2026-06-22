# Prompt para Claude Code — Produto Hermes Task 7

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido:

Produto Hermes é uma plataforma de atendimento WhatsApp por IA. Estamos construindo primeiro um MVP simulado, sem WhatsApp real ainda.

Já foram concluídas:

- Task 1: app inicializado com o template DGC TS.
- Task 2: base de conhecimento da DGC em `knowledge/dgc/`.
- Task 3: base de conhecimento da demo assistência técnica em `knowledge/assistencia-tecnica-demo/`.
- Task 4: loader server-side da base de conhecimento em `app/lib/knowledge.server.ts`, com `loadKnowledgeBase(tenantSlug)`.
- Task 5: retrieval determinístico em `app/lib/retrieval.ts`, com `retrieveRelevantChunks(query, docs)`.
- Task 6: política de handoff em `app/lib/handoff.ts`, com `decideHandoff({ message, retrievedCount })`.

Agora execute somente a Task 7 do plano:

```text
Task 7: Implementar compositor de resposta com guardrails
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 7:

Criar uma função pura que monta uma resposta inicial do Hermes usando:

- a mensagem do usuário;
- os trechos encontrados pelo retrieval;
- regras de segurança para não inventar informação;
- handoff quando não houver conhecimento suficiente.

Em português simples: essa task é a primeira em que o Hermes começa a “falar”, mas ainda sem LLM/API externa. A resposta será determinística, baseada nos trechos encontrados.

Exemplo:

```text
Usuário: quanto custa o diagnóstico?
Sources: FAQ/preços da DGC
Hermes: O diagnóstico da DGC fica na faixa de R$ 300 a R$ 700. O valor final é fechado na proposta depois de entender o escopo. Se quiser, posso encaminhar para uma pessoa do time.
```

Regras importantes:

1. Execute somente a Task 7.
2. Não implemente chat/rota/UI/dashboard/banco/WhatsApp.
3. Não chame API de IA/LLM. A resposta deve ser determinística.
4. Não altere `knowledge/`, `retrieval.ts` ou `handoff.ts`, exceto se teste provar bug real e você explicar no relatório.
5. Não faça commit nem push.
6. Use TDD: primeiro crie o teste, rode para falhar, depois implemente.
7. A função deve ser pura: sem banco, sem fs, sem API, sem LLM.

Arquivos a criar:

```text
app/lib/response.ts
app/lib/response.test.ts
```

Contrato esperado:

```ts
import type { RetrievedChunk } from './retrieval'

export type AssistantDecision = {
  reply: string
  confidence: number
  sources: RetrievedChunk[]
  needsHuman: boolean
  handoffReason?: string
}

export function composeAssistantResponse(input: {
  tenantSlug: string
  userMessage: string
  sources: RetrievedChunk[]
}): AssistantDecision
```

Requisitos obrigatórios:

## 1. Sem sources

Se `sources.length === 0`, retornar:

```ts
{
  reply: 'Não encontrei essa informação na base. Vou marcar para uma pessoa do time te ajudar com segurança. Pode me dar mais contexto enquanto isso?',
  confidence: 0,
  sources: [],
  needsHuman: true,
  handoffReason: 'no_knowledge_match',
}
```

Pode ajustar levemente o texto, mas deve manter o sentido:

- não encontrou na base;
- vai chamar humano;
- pede mais contexto.

## 2. Com sources

Se houver sources:

- `needsHuman: false` por padrão;
- `sources` deve ser o array recebido;
- `confidence = Math.min(0.95, 0.45 + sources[0].score * 0.1)`;
- resposta deve ser curta, humana e segura;
- resposta deve usar informações do primeiro source;
- não inventar preço, prazo, garantia ou política fora do source;
- não usar frases proibidas: `garantido`, `certeza`, `100%`, `definitivo`.

## 3. Próximo passo

Se a mensagem do usuário indicar orçamento/agendamento/problema, a resposta deve incluir uma pergunta de próximo passo.

Gatilhos mínimos:

```text
orçamento
orcamento
agendar
agenda
visita
problema
parou
não funciona
nao funciona
geladeira
máquina
maquina
ar-condicionado
```

Exemplo de próximo passo para assistência técnica:

```text
Para eu te orientar melhor, me diga seu bairro, o equipamento e o que aconteceu.
```

## 4. Preço fechado

Se o usuário pedir preço fechado/valor final, a resposta não pode cravar valor. Deve reforçar que depende de proposta/avaliação/base.

Gatilhos mínimos:

```text
preço fechado
preco fechado
valor final
quanto fica
fechar valor
```

Resposta deve conter alguma ideia como:

```text
não consigo fechar um valor final por aqui
```

ou

```text
o valor final depende da avaliação/proposta
```

## 5. Sanitização simples do snippet

A resposta pode usar o `snippet` do primeiro source, mas deve:

- colapsar espaços;
- limitar trecho citado para evitar resposta gigante;
- não despejar markdown inteiro.

Sugestão: usar no máximo 280 caracteres do snippet principal.

## 6. Tom por tenant

Para este MVP, pode usar regras simples:

- `tenantSlug === 'assistencia-tecnica-demo'`: tom de assistência técnica, mais acolhedor e orientado a agendamento.
- qualquer outro tenant, inclusive `dgc`: tom direto e consultivo.

Não precisa carregar `tom_de_voz.md` aqui. Isso fica para evolução futura. Use apenas o `tenantSlug`.

Teste mínimo obrigatório em `app/lib/response.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { RetrievedChunk } from './retrieval'
import { composeAssistantResponse } from './response'

const source: RetrievedChunk = {
  fileName: 'precos_servicos.md',
  title: 'Preços e serviços — DGC Hub',
  snippet: 'Diagnóstico: faixa de R$ 300 a R$ 700. O preço final é definido na proposta, depois do diagnóstico.',
  score: 3,
}

describe('composeAssistantResponse', () => {
  it('requests human when there are no sources', () => {
    const result = composeAssistantResponse({
      tenantSlug: 'dgc',
      userMessage: 'banana espacial',
      sources: [],
    })

    expect(result.needsHuman).toBe(true)
    expect(result.handoffReason).toBe('no_knowledge_match')
    expect(result.confidence).toBe(0)
  })

  it('composes a safe response from sources', () => {
    const result = composeAssistantResponse({
      tenantSlug: 'dgc',
      userMessage: 'quanto custa o diagnóstico?',
      sources: [source],
    })

    expect(result.needsHuman).toBe(false)
    expect(result.reply).toContain('R$ 300 a R$ 700')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.sources).toEqual([source])
  })
})
```

Adicione também testes extras para:

1. `confidence` respeita fórmula e teto 0.95;
2. sem sources retorna exatamente `sources: []`;
3. resposta não contém palavras proibidas: `garantido`, `certeza`, `100%`, `definitivo`;
4. pedido de preço fechado não crava valor final;
5. mensagem de assistência técnica com `geladeira parou` inclui pergunta de bairro/equipamento/problema;
6. snippet longo é truncado/limitado na resposta;
7. tenant `assistencia-tecnica-demo` gera tom/next step de assistência técnica;
8. tenant `dgc` gera tom consultivo da DGC.

Sugestão de funções privadas:

```ts
function normalizeText(value: string): string
function includesAny(value: string, phrases: string[]): boolean
function compactSnippet(snippet: string): string
function hasForbiddenClaim(reply: string): boolean
```

Não exporte essas funções se não for necessário. Preferir testar via `composeAssistantResponse`.

Passos esperados:

1. Verificar estado inicial:

```bash
cd /home/pi/projects/produto-hermes
git status --short --branch
```

2. Criar `app/lib/response.test.ts` primeiro.

3. Rodar teste para ver falhar:

```bash
npm test -- app/lib/response.test.ts
```

Resultado esperado: falha porque `response.ts` ainda não existe.

4. Criar `app/lib/response.ts`.

5. Rodar teste específico:

```bash
npm test -- app/lib/response.test.ts
```

Resultado esperado: PASS.

6. Rodar validações completas:

```bash
npm run typecheck
npm test
npm run lint
```

Se o lint reclamar de estilo/import/order, corrija somente isso.

No final, reporte:

```text
Status: PASS / FAIL / BLOCKED
Arquivos alterados:
- ...

Validações:
- teste vermelho inicial: PASS/FAIL/OBS
- npm test -- app/lib/response.test.ts: PASS/FAIL
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL

Comportamento implementado:
- sem sources / handoff
- resposta com sources
- confidence
- palavras proibidas
- preço fechado
- próximo passo assistência técnica
- truncamento de snippet
- diferença simples por tenant

Observações:
- ...

Próximo passo recomendado:
- Task 8: atualizar Prisma schema e criar migration
```

Lembrete: não commitar, não dar push, não implementar Task 8.
