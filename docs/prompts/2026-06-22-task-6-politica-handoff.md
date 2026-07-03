# Prompt para Claude Code — Produto Hermes Task 6

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

Agora execute somente a Task 6 do plano:

```text
Task 6: Implementar política de handoff
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 6:

Criar uma função pura que decide quando o Hermes deve chamar um humano em vez de tentar responder sozinho.

Em português simples: essa task ensina o Hermes a saber quando parar e passar a conversa para Gabriel/Danilo/atendente.

Exemplos:

```text
"quero falar com uma pessoa" -> precisa humano
"isso envolve contrato e LGPD" -> precisa humano
retrieval encontrou 0 documentos -> precisa humano
"quanto custa o diagnóstico?" com documentos encontrados -> não precisa humano
```

Regras importantes:

1. Execute somente a Task 6.
2. Não implemente resposta final da IA — isso é Task 7.
3. Não implemente chat, dashboard, banco de conversas ou WhatsApp.
4. Não altere `knowledge/`.
5. Não altere `retrieval.ts`, exceto se um teste provar bug real e você explicar no relatório.
6. Não faça commit nem push.
7. Use TDD: primeiro crie o teste, rode para falhar, depois implemente.
8. A função deve ser pura e determinística: sem banco, sem fs, sem API, sem LLM.

Arquivos a criar:

```text
app/lib/handoff.ts
app/lib/handoff.test.ts
```

Contrato esperado:

```ts
export type HandoffDecision = {
  needsHuman: boolean
  reason?: string
}

export function decideHandoff(input: {
  message: string
  retrievedCount: number
}): HandoffDecision
```

Regras obrigatórias:

1. Se a mensagem indicar pedido de humano, retornar:

```ts
{ needsHuman: true, reason: 'requested_human' }
```

Termos/gatilhos mínimos:

```text
humano
atendente
pessoa
falar com alguém
falar com alguem
alguém do time
alguem do time
```

2. Se `retrievedCount === 0`, retornar:

```ts
{ needsHuman: true, reason: 'no_knowledge_match' }
```

3. Se a mensagem envolver assunto sensível, retornar:

```ts
{ needsHuman: true, reason: 'sensitive_topic' }
```

Termos/gatilhos mínimos:

```text
contrato
lgpd
jurídico
juridico
processo
dados pessoais
```

4. Caso contrário, retornar:

```ts
{ needsHuman: false }
```

5. Normalizar mensagem:
   - minúsculas;
   - remover acentos;
   - fazer match de forma simples e previsível.

6. Precedência obrigatória quando mais de uma regra casar:
   1. pedido de humano (`requested_human`)
   2. assunto sensível (`sensitive_topic`)
   3. sem conhecimento (`no_knowledge_match`)
   4. sem handoff

Motivo: se a pessoa pede humano e também não há match, queremos registrar que ela pediu humano.

Teste mínimo em `app/lib/handoff.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decideHandoff } from './handoff'

describe('decideHandoff', () => {
  it('requests human when the user asks for a person', () => {
    expect(decideHandoff({ message: 'quero falar com um atendente', retrievedCount: 2 })).toEqual({
      needsHuman: true,
      reason: 'requested_human',
    })
  })

  it('requests human when there is no knowledge match', () => {
    expect(decideHandoff({ message: 'banana espacial', retrievedCount: 0 })).toEqual({
      needsHuman: true,
      reason: 'no_knowledge_match',
    })
  })

  it('requests human for sensitive topics', () => {
    expect(decideHandoff({ message: 'quero falar sobre contrato e LGPD', retrievedCount: 2 })).toEqual({
      needsHuman: true,
      reason: 'sensitive_topic',
    })
  })

  it('does not request human for a normal message with matches', () => {
    expect(decideHandoff({ message: 'quanto custa o diagnóstico?', retrievedCount: 2 })).toEqual({
      needsHuman: false,
    })
  })
})
```

Adicione também testes extras para:

1. acento: `jurídico` e `juridico` devem funcionar;
2. frase `falar com alguém` com acento e sem acento;
3. precedência: se mensagem pede humano e `retrievedCount` é 0, reason deve ser `requested_human`;
4. precedência: se mensagem tem assunto sensível e `retrievedCount` é 0, reason deve ser `sensitive_topic`;
5. `retrievedCount` negativo deve ser tratado como 0 ou rejeitado? Para simplificar MVP, trate `retrievedCount <= 0` como sem conhecimento.
6. mensagem vazia com `retrievedCount > 0` não precisa humano;
7. mensagem vazia com `retrievedCount === 0` precisa humano por `no_knowledge_match`.

Sugestão de estrutura interna:

```ts
function normalizeText(value: string): string
function includesAny(value: string, phrases: string[]): boolean
```

Essas funções podem ficar privadas no próprio `handoff.ts`. Preferir testar comportamento público via `decideHandoff`.

Passos esperados:

1. Verificar estado inicial:

```bash
cd /home/pi/projects/produto-hermes
git status --short --branch
```

2. Criar `app/lib/handoff.test.ts` primeiro.

3. Rodar teste para ver falhar:

```bash
npm test -- app/lib/handoff.test.ts
```

Resultado esperado: falha porque `handoff.ts` ainda não existe.

4. Criar `app/lib/handoff.ts`.

5. Rodar teste específico:

```bash
npm test -- app/lib/handoff.test.ts
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
- npm test -- app/lib/handoff.test.ts: PASS/FAIL
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL

Comportamento implementado:
- pedido de humano
- sem conhecimento
- assunto sensível
- precedência
- normalização/acento
- retrievedCount <= 0
- caso normal sem handoff

Observações:
- ...

Próximo passo recomendado:
- Task 7: implementar compositor de resposta com guardrails
```

Lembrete: não commitar, não dar push, não implementar Task 7.
