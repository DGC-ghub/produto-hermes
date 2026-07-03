# Prompt para Claude Code — Produto Hermes Task 9

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido:

Produto Hermes é uma plataforma de atendimento WhatsApp por IA. Estamos construindo primeiro um MVP simulado, sem WhatsApp real ainda.

Já foram concluídas:

- Task 1: app inicializado com o template DGC TS.
- Task 2: base de conhecimento da DGC em `knowledge/dgc/`.
- Task 3: base de conhecimento da demo assistência técnica em `knowledge/assistencia-tecnica-demo/`.
- Task 4: loader da base de conhecimento em `app/lib/knowledge.server.ts`.
- Task 5: retrieval determinístico em `app/lib/retrieval.ts`.
- Task 6: política de handoff em `app/lib/handoff.ts`.
- Task 7: compositor de resposta com guardrails em `app/lib/response.ts`.
- Task 8: schema/migration Prisma com `Tenant`, `Conversation`, `Message`, `Lead`, `HandoffEvent`.

Agora execute somente a Task 9 do plano:

```text
Task 9: Criar seeds mínimos/helper de tenants
```

Plano completo:

```text
docs/plano-tecnico-mvp-simulado.md
```

Objetivo da Task 9:

Criar um helper server-side que garante que os tenants iniciais existem no banco:

```text
dgc
assistencia-tecnica-demo
```

Em português simples: agora que existe tabela `Tenant`, essa task cria uma função para garantir que as duas empresas demo existem no banco antes do simulador usar.

Decisão explícita para esta task:

- Fazer **helper + smoke script manual**, não criar seed script oficial em `package.json` ainda.
- Motivo: YAGNI. O simulador poderá chamar o helper depois; por enquanto só precisamos validar que o helper funciona.
- Não criar rota, UI, chat, dashboard ou banco de conversas.

Regras importantes:

1. Execute somente a Task 9.
2. Não implemente Task 10.
3. Não altere schema Prisma nem crie nova migration.
4. Não altere `knowledge/`.
5. Não altere o cérebro determinístico (`knowledge.server.ts`, `retrieval.ts`, `handoff.ts`, `response.ts`).
6. Não faça commit nem push.
7. Arquivos que tocam banco devem ser server-side.
8. `dev.db` e `.env` devem continuar fora do git.

Arquivos a criar:

```text
app/lib/tenants.server.ts
app/lib/tenants.server.test.ts
scripts/smoke-tenants.ts
```

Contrato esperado em `app/lib/tenants.server.ts`:

```ts
import { db } from '../db.server'

export type TenantInput = {
  slug: string
  name: string
}

export const INITIAL_TENANTS = [
  { slug: 'dgc', name: 'DGC Hub' },
  { slug: 'assistencia-tecnica-demo', name: 'ResolveTech Assistência (Demo)' },
] as const

export async function ensureTenant(input: TenantInput) {
  // db.tenant.upsert(...)
}

export async function ensureInitialTenants() {
  // Promise.all ou loop chamando ensureTenant para INITIAL_TENANTS
}
```

Requisitos do helper:

1. `ensureTenant({ slug, name })` deve usar `db.tenant.upsert`.
2. Se o tenant não existe, cria.
3. Se o tenant já existe, atualiza o `name` mantendo o mesmo registro.
4. Retorna o tenant salvo.
5. Validar slug seguro com regex:

```ts
/^[a-z0-9-]+$/
```

6. Se slug inválido, lançar erro com mensagem contendo `Invalid tenant slug`.
7. `ensureInitialTenants()` garante os dois tenants iniciais:

```text
dgc -> DGC Hub
assistencia-tecnica-demo -> ResolveTech Assistência (Demo)
```

8. Não usar `deleteMany` dentro do helper real.

Teste em `app/lib/tenants.server.test.ts`:

Como essa task encosta no banco real local, use TDD com cuidado.

Critério definido:

- Pode usar o `dev.db` local de desenvolvimento, pois a Task 8 já criou `.env` e aplicou migration.
- O teste deve limpar apenas tenants com slug de teste, nunca limpar os tenants reais `dgc` e `assistencia-tecnica-demo`.
- Não usar `db.tenant.deleteMany()` sem filtro.

Testes obrigatórios:

1. `ensureTenant` cria um tenant novo com slug de teste.
2. `ensureTenant` é idempotente: chamar duas vezes com mesmo slug não cria duplicado e atualiza name.
3. `ensureTenant` rejeita slug inseguro.
4. `ensureInitialTenants` cria/garante `dgc` e `assistencia-tecnica-demo`.

Slug de teste sugerido:

```text
zzz-test-tenant-task-9
```

Estrutura sugerida do teste:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db.server'
import { ensureInitialTenants, ensureTenant } from './tenants.server'

const TEST_SLUG = 'zzz-test-tenant-task-9'

afterEach(async () => {
  await db.tenant.deleteMany({ where: { slug: TEST_SLUG } })
})
```

Atenção:

Se as relações impedirem apagar tenant de teste no futuro, ajuste o cleanup filtrado para apagar dependências do tenant de teste, mas nesta Task 9 ainda não deve haver conversas.

Smoke script em `scripts/smoke-tenants.ts`:

Criar um script simples para execução manual:

```ts
import { ensureInitialTenants } from '../app/lib/tenants.server'

const tenants = await ensureInitialTenants()
console.log(JSON.stringify(tenants.map((tenant) => ({ slug: tenant.slug, name: tenant.name })), null, 2))
```

Se precisar fechar conexão Prisma no fim, use o método disponível no client gerado/importado. Se não for necessário no ambiente atual, tudo bem, mas reporte.

Não adicionar script no `package.json` nesta task, a menos que seja indispensável. Preferência: rodar manualmente com `npx tsx` se disponível? Verifique dependências antes. Se `tsx` não existir, não instale pacote novo. Pode pular execução do smoke script e validar pelo teste + um comando Node/Prisma simples, mas explique no relatório.

Passos esperados:

1. Verificar estado inicial:

```bash
cd /home/pi/projects/produto-hermes
git status --short --branch
```

2. Criar `app/lib/tenants.server.test.ts` primeiro.

3. Rodar teste para ver falhar:

```bash
npm test -- app/lib/tenants.server.test.ts
```

Resultado esperado: falha porque `tenants.server.ts` ainda não existe.

4. Criar `app/lib/tenants.server.ts`.

5. Rodar teste específico:

```bash
npm test -- app/lib/tenants.server.test.ts
```

Resultado esperado: PASS.

6. Criar `scripts/smoke-tenants.ts`.

7. Rodar validações completas:

```bash
npm run typecheck
npm test
npm run lint
```

8. Rodar smoke manual se viável sem instalar dependência nova. Exemplos possíveis:

```bash
node --experimental-strip-types scripts/smoke-tenants.ts
```

ou, se já houver runner compatível disponível:

```bash
npx tsx scripts/smoke-tenants.ts
```

Não instale dependência só para o smoke.

9. Verificar git status:

```bash
git status --short
git status --ignored --short | sed -n '1,80p'
```

No final, reporte:

```text
Status: PASS / FAIL / BLOCKED
Arquivos alterados:
- ...

Validações:
- teste vermelho inicial: PASS/FAIL/OBS
- npm test -- app/lib/tenants.server.test.ts: PASS/FAIL
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL
- smoke tenants: PASS/FAIL/NOT RUN + motivo

Banco local:
- tenants garantidos no dev.db: SIM/NÃO
- .env/dev.db apareceram no git status normal? SIM/NÃO

Comportamento implementado:
- ensureTenant cria
- ensureTenant atualiza/idempotente
- slug inválido
- ensureInitialTenants dgc + assistencia-tecnica-demo

Observações:
- ...

Próximo passo recomendado:
- Task 10: criar rota do simulador de conversa
```

Lembrete: não commitar, não dar push, não implementar Task 10.
