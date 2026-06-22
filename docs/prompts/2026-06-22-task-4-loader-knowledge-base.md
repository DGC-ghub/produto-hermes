# Prompt para Claude Code — Produto Hermes Task 4

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido:

Produto Hermes é uma plataforma de atendimento WhatsApp por IA. Estamos construindo primeiro um MVP simulado, sem WhatsApp real ainda.

Já foram concluídas:

- Task 1: app inicializado com o template DGC TS.
- Task 2: base de conhecimento da DGC em `knowledge/dgc/`.
- Task 3: base de conhecimento da demo assistência técnica em `knowledge/assistencia-tecnica-demo/`.

Agora execute somente a Task 4 do plano:

```text
Task 4: Implementar loader da base de conhecimento
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 4:

Criar uma função server-side que lê os arquivos markdown de uma base de conhecimento, por exemplo:

```text
knowledge/dgc/*.md
knowledge/assistencia-tecnica-demo/*.md
```

e retorna esses documentos em formato estruturado para o sistema usar depois.

Em português simples: essa task ensina o app a abrir a “memória” de cada empresa.

Regras importantes:

1. Execute somente a Task 4.
2. Não implemente retrieval ainda — isso é Task 5.
3. Não implemente IA/resposta/chat/dashboard/banco de conversas.
4. Não altere o conteúdo dos arquivos em `knowledge/`, a menos que um teste prove problema real.
5. Não faça commit nem push.
6. Use TDD: primeiro crie o teste, rode para falhar, depois implemente.
7. O loader deve ser server-side. Arquivo alvo: `app/lib/knowledge.server.ts`.

Arquivos a criar:

```text
app/lib/knowledge.server.ts
app/lib/knowledge.test.ts
```

Contrato esperado:

```ts
export type KnowledgeDocument = {
  tenantSlug: string;
  fileName: string;
  title: string;
  content: string;
};

export async function loadKnowledgeBase(tenantSlug: string): Promise<KnowledgeDocument[]>;
```

Requisitos do loader:

1. Aceitar apenas slug seguro com regex:

```ts
/^[a-z0-9-]+$/
```

2. Rejeitar slugs inseguros, por exemplo:

```text
../dgc
DGC
abc_def
```

3. Ler arquivos `.md` da pasta:

```text
knowledge/{tenantSlug}/
```

4. Ignorar arquivos que não sejam `.md`.
5. Ordenar resultado por `fileName`.
6. `title` deve vir da primeira linha que começa com `# `.
7. Se não tiver título `# `, usar o nome do arquivo como fallback.
8. `content` deve ser o conteúdo completo do arquivo.
9. Se a pasta do tenant não existir, retornar array vazio ou lançar erro controlado? Para esta task, prefira retornar `[]` para simplificar o MVP.
10. Não importar esse arquivo em componente React. Ele é server-side.

Teste mínimo obrigatório em `app/lib/knowledge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "./knowledge.server";

describe("loadKnowledgeBase", () => {
  it("loads markdown documents for a tenant", async () => {
    const docs = await loadKnowledgeBase("dgc");

    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0]).toHaveProperty("tenantSlug", "dgc");
    expect(docs.some((doc) => doc.fileName === "faq.md")).toBe(true);
  });
});
```

Adicione também testes extras para:

1. carregar `assistencia-tecnica-demo`;
2. ordenar por `fileName`;
3. extrair título da primeira linha `# ...`;
4. retornar `[]` para tenant inexistente;
5. rejeitar slug inseguro.

Sugestão de comportamento para slug inseguro:

```ts
await expect(loadKnowledgeBase("../dgc")).rejects.toThrow("Invalid tenant slug");
```

Passos esperados:

1. Verificar estado inicial:

```bash
cd /home/pi/projects/produto-hermes
git status --short --branch
```

2. Criar `app/lib/knowledge.test.ts` primeiro.

3. Rodar teste para ver falhar:

```bash
npm test -- app/lib/knowledge.test.ts
```

Resultado esperado: falha porque `knowledge.server.ts` ainda não existe.

4. Criar `app/lib/knowledge.server.ts`.

5. Rodar teste específico:

```bash
npm test -- app/lib/knowledge.test.ts
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
- npm test -- app/lib/knowledge.test.ts: PASS/FAIL
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL

Comportamento implementado:
- slugs aceitos/rejeitados
- tenant inexistente
- ordenação
- extração de título

Observações:
- ...

Próximo passo recomendado:
- Task 5: implementar retrieval simples e determinístico
```

Lembrete: não commitar, não dar push, não implementar Task 5.
