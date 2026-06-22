# Prompt para Claude Code — Produto Hermes Task 1

Cole este prompt no Claude Code aberto em `/home/pi/projects/produto-hermes`.

---

Você está no repo `DGC-ghub/produto-hermes`.

Contexto rápido:

Produto Hermes é o primeiro produto próprio da DGC Hub: uma plataforma de atendimento no WhatsApp por IA. A primeira versão NÃO deve conectar WhatsApp real ainda. O objetivo agora é preparar a base do app para depois construir um simulador de conversa.

O plano técnico completo está em:

```text
docs/plano-tecnico-mvp-simulado.md
```

Execute somente a Task 1 desse plano:

```text
Task 1: Inicializar app pelo template DGC TS
```

Objetivo da Task 1:

Transformar este repo em um app web baseado no template `dgc-template-ts`, preservando os documentos existentes do Produto Hermes.

Regras importantes:

1. Não implemente ainda chat, IA, RAG, banco de conversas, dashboard ou WhatsApp.
2. Não avance para Task 2.
3. Não apague os docs existentes.
4. Não faça commit nem push.
5. Se houver conflito entre template e docs atuais, preserve os docs do Produto Hermes.
6. Mantenha a stack do template:
   - React Router v8
   - React 19
   - TypeScript strict
   - Tailwind CSS v4
   - Prisma + SQLite
   - Biome
   - Vitest

Repos locais esperados:

```text
/home/pi/projects/produto-hermes
/home/pi/projects/dgc-template-ts
```

Passos esperados:

1. Verificar estado inicial:

```bash
cd /home/pi/projects/produto-hermes
git status --short --branch
find . -maxdepth 3 -type f | sort
```

2. Copiar o template para o repo, sem copiar `.git` e sem sobrescrever a pasta `docs` do Produto Hermes:

```bash
rsync -av --exclude .git --exclude docs /home/pi/projects/dgc-template-ts/ ./
```

3. Ajustar `package.json`:

Trocar:

```json
"name": "dgc-template-ts"
```

por:

```json
"name": "produto-hermes"
```

4. Verificar se os docs continuam existindo:

```bash
ls -la docs
```

Devem continuar existindo pelo menos:

```text
docs/briefing.md
docs/regra-de-negocio.md
docs/roadmap.md
docs/plano-tecnico-mvp-simulado.md
```

5. Rodar instalação:

```bash
npm install
```

6. Rodar validações baseline:

```bash
npm run typecheck
npm test
npm run lint
```

Se algum comando falhar, corrija apenas problemas causados pela inicialização do template. Não implemente funcionalidades novas.

7. No final, reporte:

```text
Status: PASS / FAIL / BLOCKED
Arquivos alterados:
- ...

Validações:
- npm install: PASS/FAIL
- npm run typecheck: PASS/FAIL
- npm test: PASS/FAIL
- npm run lint: PASS/FAIL

Observações:
- ...

Próximo passo recomendado:
- Task 2: criar base de conhecimento dogfood da DGC
```

Lembrete: não commitar, não dar push, não implementar Task 2.
