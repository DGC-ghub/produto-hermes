# Prompt para Claude Code — Produto Hermes Task 5

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

Agora execute somente a Task 5 do plano:

```text
Task 5: Implementar retrieval simples e determinístico
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 5:

Criar uma função pura que recebe uma pergunta do usuário e os documentos carregados pela Task 4, e retorna os trechos/documentos mais relevantes.

Em português simples: agora que o app sabe abrir a “memória” da empresa, essa task ensina o app a escolher qual parte dessa memória parece responder a pergunta.

Exemplo desejado:

```text
Pergunta: "quanto custa o diagnóstico?"
Documentos: FAQ, preços, perfil...
Resultado esperado: retornar FAQ/preços como mais relevantes.
```

Regras importantes:

1. Execute somente a Task 5.
2. Não implemente IA/resposta final — isso é Task 7.
3. Não implemente handoff — isso é Task 6.
4. Não implemente chat, dashboard, banco de conversas ou WhatsApp.
5. Não altere `knowledge/`, exceto se um teste provar problema real — e nesse caso explique antes no relatório.
6. Não faça commit nem push.
7. Use TDD: primeiro crie o teste, rode para falhar, depois implemente.
8. A função deve ser pura e determinística: sem banco, sem fs, sem API, sem LLM.

Arquivos a criar:

```text
app/lib/retrieval.ts
app/lib/retrieval.test.ts
```

Contrato esperado:

```ts
import type { KnowledgeDocument } from './knowledge.server'

export type RetrievedChunk = {
  fileName: string
  title: string
  snippet: string
  score: number
}

export function retrieveRelevantChunks(
  query: string,
  docs: KnowledgeDocument[],
): RetrievedChunk[]
```

Requisitos do retrieval:

1. Normalizar texto:
   - minúsculas;
   - remover acentos;
   - separar por palavras;
   - ignorar tokens com menos de 3 caracteres.

2. Remover stopwords básicas em português:

```ts
const STOPWORDS = new Set([
  'que',
  'para',
  'com',
  'uma',
  'como',
  'qual',
  'quanto',
  'pela',
  'pelo',
  'dos',
  'das',
  'você',
  'vocês',
  'tem',
  'mais',
])
```

3. Score:
   - contar quantos tokens úteis da query aparecem no `title` ou no `content` do documento;
   - match em `title` pode valer 2 pontos;
   - match em `content` pode valer 1 ponto;
   - score final deve ser número > 0 para documentos relevantes.

4. Retorno:
   - filtrar documentos com score 0;
   - ordenar por score decrescente;
   - desempate por `fileName` ascendente;
   - retornar no máximo 3 resultados;
   - `snippet` deve ter no máximo 500 caracteres;
   - se não houver tokens úteis ou match útil, retornar `[]`.

5. Não retornar conteúdo completo no `snippet`; ele deve ser curto para depois caber na resposta do Hermes.

Teste mínimo obrigatório em `app/lib/retrieval.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { KnowledgeDocument } from './knowledge.server'
import { retrieveRelevantChunks } from './retrieval'

const docs: KnowledgeDocument[] = [
  {
    tenantSlug: 'dgc',
    fileName: 'faq.md',
    title: 'FAQ',
    content: 'Diagnóstico custa de R$ 300 a R$ 700.',
  },
  {
    tenantSlug: 'dgc',
    fileName: 'tom.md',
    title: 'Tom',
    content: 'Responder de forma direta.',
  },
]

describe('retrieveRelevantChunks', () => {
  it('returns chunks matching query terms', () => {
    const result = retrieveRelevantChunks('quanto custa o diagnóstico?', docs)
    expect(result[0]?.fileName).toBe('faq.md')
    expect(result[0]?.score).toBeGreaterThan(0)
  })

  it('returns empty when there is no useful match', () => {
    const result = retrieveRelevantChunks('banana espacial', docs)
    expect(result).toEqual([])
  })
})
```

Adicione também testes extras para:

1. remover acentos: `diagnostico` deve casar com `Diagnóstico`;
2. ignorar stopwords e tokens curtos;
3. limitar retorno a 3 resultados;
4. ordenar por score decrescente;
5. desempatar por `fileName`;
6. criar snippet com até 500 caracteres;
7. query vazia ou só stopwords retorna `[]`;
8. funcionar com documentos reais carregados por `loadKnowledgeBase('dgc')` se quiser integrar com a Task 4 — opcional, mas recomendado.

Sugestão de estrutura interna:

```ts
function normalizeText(value: string): string
function tokenize(value: string): string[]
function buildSnippet(content: string): string
```

Essas funções podem ficar privadas no próprio `retrieval.ts`, a menos que os testes precisem delas. Preferir testar comportamento público via `retrieveRelevantChunks`.

Passos esperados:

1. Verificar estado inicial:

```bash
cd /home/pi/projects/produto-hermes
git status --short --branch
```

2. Criar `app/lib/retrieval.test.ts` primeiro.

3. Rodar teste para ver falhar:

```bash
npm test -- app/lib/retrieval.test.ts
```

Resultado esperado: falha porque `retrieval.ts` ainda não existe.

4. Criar `app/lib/retrieval.ts`.

5. Rodar teste específico:

```bash
npm test -- app/lib/retrieval.test.ts
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
- npm test -- app/lib/retrieval.test.ts: PASS/FAIL
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL

Comportamento implementado:
- normalização
- stopwords/tokens curtos
- score
- ordenação/desempate
- limite de 3 resultados
- snippet
- query sem match

Observações:
- ...

Próximo passo recomendado:
- Task 6: implementar política de handoff
```

Lembrete: não commitar, não dar push, não implementar Task 6.
