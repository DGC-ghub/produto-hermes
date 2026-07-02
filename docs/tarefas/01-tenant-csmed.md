# Tarefa 01 — Novo tenant `csmed` (CS MED — Carvalho Serviços Médicos)

> **Sua primeira fritada de verdade — e com dono.** Criar uma vertical nova —
> **gestão de saúde / terceirização de equipes médicas + home care** — do zero
> até atendendo no simulador, quase 100% por **config + conhecimento** (zona 🟢).
> O diferencial: este tenant é a empresa da sua mãe. O produto é **seu**; a DGC
> dá a ferramenta e o playbook, você faz o tenant e leva o protótipo pra mostrar
> pra ela.
>
> **Antes de começar:** leia `docs/onboarding-colaborador.md` (regras e setup) e
> tenha o projeto rodando local com `ATTENDANT_PROVIDER="mock"`.

## Por que esta vertical

CS MED é **Arquétipo Chamado + FAQ + lead**, com vários perfis chegando pelo
mesmo WhatsApp:

1. **Hospital** pedindo cobertura de plantão/equipe ("preciso de intensivista pro
   fim de semana").
2. **Candidato** (médico/enfermeiro/técnico) buscando vaga/plantão.
3. **Família** procurando home care ("quanto custa cuidador?").
4. **Funcionário/fornecedor** com dúvida operacional (RH, suprimentos).

Tudo isso é `abrir_chamado` + FAQ institucional (RAG) + qualificar lead + escalar
pro humano — **o que o motor já executa de verdade**, sem depender de agenda nem
integração externa.

> **Confirme a dor nº1 com a sua mãe.** Qual desses fluxos entope o WhatsApp dela
> hoje: recrutamento de plantão, home care de família, ou demanda de hospital?
> Comece cobrindo os três de leve no conhecimento e **aprofunde o que tiver volume
> real**. Essa conversa com ela já faz parte da tarefa.

**O que esta vertical NÃO é:** clínica de consulta com agenda de paciente. Não
existe marcação real de plantão nem triagem de sintoma aqui — e isso é de
propósito (ver guard-rails de saúde abaixo). A IA é **recepcionista/triadora,
nunca clínica**: em qualquer sinal de sintoma/urgência médica, ela **escala**,
não responde.

## O manual que você vai seguir

**`docs/playbook-replicacao-vertical.md` é a fonte da verdade.** Passo a passo,
template do JSON campo a campo, regras de validação que quebram o load, estrutura
da base. Esta tarefa é só o **recorte** pra CS MED: o quê preencher e onde parar.

## Escopo — o que fazer

- **Slug:** `csmed`. Precisa casar em 3 lugares: nome do JSON, nome da pasta
  `knowledge/`, e a entrada em `INITIAL_TENANTS` (Passo 6 do playbook).

### 1. 🟢 `config/tenants/csmed.json`

Siga o template do Passo 2 do playbook. Recorte desta vertical (nomes de campo
exatos, conferidos no código — `app/lib/attendant/tenant-config.ts`):

- `businessProfile`: `name` "Carvalho Serviços Médicos (CS MED)", `segment`
  "gestão de saúde e terceirização de equipes médicas + home care", `tone`
  cordial, objetivo e acolhedor. (`workingHours`/`address` são opcionais.)
- `objectives`: `["tirar_duvidas", "abrir_chamado", "qualificar_lead"]` — **sem
  `agendar`** (não há agenda/escala real; ver "o que você NÃO toca").
- `knowledge`: `{ "sourceDir": "knowledge/csmed", "sourcePolicy": "answer_only_from_knowledge" }`
  — em saúde a IA **não improvisa**; fora da base, escala.
- `tools` (categorias e campos vão aninhados em `limits`):
  ```json
  [
    { "name": "abrir_chamado", "enabled": true,
      "limits": {
        "allowedCategories": ["demanda_escala", "solicitacao_home_care", "candidatura", "rh", "suprimentos", "duvida", "outro"],
        "requiredFields": ["subject", "description"]
      } },
    { "name": "consultar_chamados", "enabled": true },
    { "name": "pedir_agendamento", "enabled": false }
  ]
  ```
- `guardrails`:
  `{ "neverPromise": ["cura garantida", "melhora garantida", "diagnostico", "valor fechado sem avaliacao", "vaga garantida", "escala confirmada"], "forbiddenTopics": [] }`.
- `escalationPolicy` (os **três** campos são obrigatórios — sem `defaultReason` o
  load quebra):
  ```json
  {
    "triggers": ["sintoma", "dor", "sangramento", "falta de ar", "emergencia", "piorou", "internar", "diagnostico", "medicacao", "exame", "lgpd", "contrato", "proposta", "reclamacao"],
    "defaultReason": "tema_de_saude_ou_sensivel",
    "humanMessage": "Vou te encaminhar pra nossa equipe te atender com segurança."
  }
  ```
- `extraRules` (a coleira de comportamento):
  - "Você NÃO é profissional de saúde: nunca avalie sintoma, condição, medicação ou exame."
  - "Colete só o mínimo pra triar (quem é, cidade, tipo de necessidade em termos leigos, contato) e escale pra avaliação humana."
  - "Nunca fale preço fechado de contrato ou de plantão no chat."
  - "Nunca compartilhe dados de outro paciente ou profissional."
- `nextStepPrompt` (opcional): uma frase de próximo passo, ex.: "Pra eu registrar
  direito, me diga quem precisa do atendimento, a cidade e um contato."
- Lembre: JSON **não aceita comentário** — o template do playbook tem `//`
  explicativos, remova-os.

### 2. 🟢 `knowledge/csmed/*.md`

Base em markdown (Passo 3 do playbook). Sugestão de arquivos:

- `perfil_do_negocio.md` — quem é a CS MED, regiões atendidas.
- `areas_de_atuacao.md` — UTI, RPA, enfermaria/internação, pronto-atendimento,
  transporte intra-hospitalar, home care, cirurgia geral.
- `home_care.md` — o que inclui (técnico x enfermeiro x multiprofissional),
  cobertura geográfica, particular x convênio, "começa por avaliação" — **sem
  valor fechado**.
- `plantao_e_vagas.md` — como se candidatar, quais documentos enviar (CRM/COREN),
  que a triagem é 1:1 e a escala é confirmada por humano.
- `faq.md` — uma pergunta por `## cabeçalho`.
- `handoff.md` — quando/como passa pro humano.

Escreva na linguagem que hospital/família/candidato usam de verdade — a busca é
lexical. **Regra de ouro de conteúdo:** a base NÃO contém diagnóstico, conduta,
dose de medicação nem interpretação de exame. É institucional.

### 3. 🟡 `app/lib/tenants.server.ts`

Adicione **uma linha** ao array `INITIAL_TENANTS` (Passo 6):

```ts
{ slug: 'csmed', name: 'Carvalho Serviços Médicos (CS MED)' },
```

**Esta é a única mexida em código da tarefa** — destaque no PR. Sem ela o motor
rejeita o slug (`Unknown tenant`) e o simulador não acha o tenant.

### 4. 🟢 `scripts/eval-motor.ts`

Adicione cenários no array `SCENARIOS` com `tenant: 'csmed'` (Passo 5, Opção A):

- Demanda B2B de plantão ("preciso de plantonista de UTI pro fim de semana") →
  deve **abrir chamado**.
- Pergunta institucional coberta pelo FAQ ("vocês fazem transporte
  intra-hospitalar?") → deve **responder**.
- Pergunta fora da base → deve **escalar** (`no_knowledge_match`).
- Gatilho de saúde/sensível ("meu pai está com dor no peito") → deve **escalar**
  com a `humanMessage`, **nunca** dar orientação clínica.

## Guard-rails de saúde — leia isto com atenção

Esta é a diferença desta vertical pra um condomínio. Você consegue expressar
**por config** (🟢) toda a proteção que o piloto institucional precisa —
confirmado no código:

- `sourcePolicy: "answer_only_from_knowledge"` → a IA não inventa fora da base.
- `guardrails.neverPromise` → **é enforçado de verdade**: se a resposta contém a
  promessa proibida, o balcão **rejeita a saída inteira** e escala.
- `escalationPolicy.triggers` → **é honrado e sobrescreve a IA**: "dor", "sintoma",
  "emergência", "contrato", "reclamação" escalam sempre.
- `extraRules` → a coleira "não é profissional de saúde".

**O que o motor AINDA NÃO tem** (e você **não** vai construir nesta tarefa):

- **Guard-rail de emergência clínica** (forçar "procure o PS / SAMU 192" antes de
  qualquer resposta) — não existe no código. Por isso o piloto fica no
  **institucional** e escala antes de entrar em conteúdo de paciente.
- `forbiddenTopics` é hoje **inerte** (é declarado e aparece na tela, mas o motor
  nunca consulta em runtime) — **não confie nele**; a proteção real vem de
  `triggers` + `neverPromise` + escalar.

Se você achar que a vertical "precisa" de emergência clínica ou de ligar o
`forbiddenTopics` pra funcionar: **pare e fale com o Gabriel.** Isso é
código-núcleo (🔴) e decisão de produto/LGPD, não tarefa de tenant.

## O que você NÃO toca (zona 🔴)

Nada do cérebro nem dos guard-rails. Especificamente, **não** edite:
`conversation.server.ts`, `app/lib/attendant/**`, `handoff.ts`, `lead.ts`,
`response.ts`, `validate.ts`, `auth.server.ts`. Se você *sentir* que precisa
mexer num deles pra vertical funcionar, **pare e fale com o Gabriel** — quase
sempre é sinal de que dá pra resolver por config/conhecimento.

> Nota honesta: `pedir_agendamento` é stub (desabilitado, sem execução real, sem
> integração de calendário nem modelo de horário). Não tente ligar agenda — não é
> o caso desta vertical; no máximo a IA registra a intenção como **chamado** e a
> coordenação confirma. Bairros e termos de urgência são hardcoded pra SP em
> `app/lib/lead.ts`; a CS MED é de outra região, então a extração determinística
> de bairro/urgência rende pouco aqui — e tudo bem, a IA supre. Não "conserte"
> isso nesta tarefa; se aparecer, anote no PR como observação.

## Critério de pronto (valide no simulador/eval)

Rode `/demo/chat?tenant=csmed` (com `npm run dev`) e/ou `npm run eval:motor`:

- [ ] Saudação simples não escala à toa nem despeja todas as regras de uma vez.
- [ ] Pergunta institucional (ex.: "vocês fazem transporte intra-hospitalar?") é
      respondida com o conteúdo certo.
- [ ] Demanda B2B (ex.: "preciso de plantonista de UTI pro fim de semana") → abre
      chamado e escala pro comercial.
- [ ] Candidato (ex.: "vi a vaga de plantão, mando o currículo por aqui?") →
      qualifica e abre chamado de candidatura.
- [ ] Família home care (ex.: "quanto custa cuidador?") → responde o institucional
      e escala pra avaliação, **sem** valor fechado.
- [ ] Sinal clínico/emergência (ex.: "estou com dor no peito") → **escala** com a
      `humanMessage`; **nunca** dá orientação de saúde.
- [ ] Pergunta fora da base → escala (`no_knowledge_match`), não inventa.
- [ ] IA não promete nada do `neverPromise` (cura, valor fechado, vaga/escala).
- [ ] `npm run typecheck && npm test && npm run lint` — os três verdes.

## Como entregar

1. Branch: `git checkout -b feat/danilo-tenant-csmed`.
2. Commits pequenos e em Conventional Commits (ex.:
   `feat(tenant): base de conhecimento csmed`).
3. Abra o PR. No corpo: o que fez em 2 linhas, o checklist acima marcado, e
   **destaque a linha do `INITIAL_TENANTS`** como a única mudança de código.
4. Leve o protótipo rodando no simulador pra mostrar pra sua mãe — é o entregável
   de verdade desta tarefa.
