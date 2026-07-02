# Tarefa 01 — Novo tenant `condominio-demo`

> **Sua primeira fritada.** Criar uma vertical nova — **condomínio /
> administradora predial** — do zero até atendendo no simulador, quase 100% por
> **config + conhecimento** (zona 🟢). É a melhor tarefa de entrada: você aprende
> o produto inteiro sem encostar no cérebro.
>
> **Antes de começar:** leia `docs/onboarding-colaborador.md` (regras e setup) e
> tenha o projeto rodando local com `ATTENDANT_PROVIDER="mock"`.

## Por que esta vertical

Condomínio é **Arquétipo Chamado puro**: o morador abre chamado o tempo todo
(lâmpada queimada, vazamento na área comum, barulho) e faz perguntas de regra
(horário de mudança, uso do salão). Isso é exatamente `abrir_chamado` + FAQ — o
que o motor **já executa de verdade**, sem depender de agenda nem integração
externa. É o próximo alvo do roadmap depois de contabilidade e assistência
técnica (ver `docs/verticais-alvo.md`, seção "Ordem de ataque").

## O manual que você vai seguir

**`docs/playbook-replicacao-vertical.md` é a fonte da verdade.** Ele tem o
passo a passo, o template do JSON campo a campo, as regras de validação que
quebram o load, e a estrutura da base de conhecimento. Esta tarefa é só o
**recorte** pra esta vertical: o quê preencher e onde parar.

## Escopo — o que fazer

- **Slug:** `condominio-demo` (segue o padrão de `assistencia-tecnica-demo`).
  Ele precisa casar em 3 lugares: nome do JSON, nome da pasta `knowledge/`, e a
  entrada em `INITIAL_TENANTS` (Passo 6 do playbook).

1. 🟢 **`config/tenants/condominio-demo.json`** — siga o template do Passo 2 do
   playbook. Recorte desta vertical:
   - `businessProfile`: uma administradora fictícia (ex.: "Administradora Predial
     Horizonte"), segmento "administração de condomínios", tom cordial e objetivo.
   - `objectives`: `["tirar_duvidas", "abrir_chamado", "qualificar_lead"]` — **sem
     agendar** (agendamento não é o caso desta vertical).
   - `tools`: `abrir_chamado` **enabled** (categorias tipo
     `["manutencao", "barulho", "area-comum", "reclamacao", "duvida", "outro"]`,
     `requiredFields: ["subject", "description"]`), `consultar_chamados`
     **enabled**, `pedir_agendamento` **disabled**.
   - `escalationPolicy.triggers`: assuntos delicados do ramo —
     `["assembleia", "inadimplencia", "multa", "obra", "conflito", "juridico do condominio"]`.
   - `guardrails.neverPromise`: `["prazo de reparo garantido", "resolucao de reclamacao entre moradores"]`.
   - `escalationPolicy.humanMessage`: uma frase de transição pro síndico/zeladoria.
   - Lembre: JSON **não aceita comentário** — o template do playbook tem `//`
     explicativos, remova-os.

2. 🟢 **`knowledge/condominio-demo/*.md`** — base de conhecimento em markdown
   (Passo 3 do playbook). Sugestão de arquivos: `perfil_do_negocio.md`,
   `regras_do_condominio.md` (horário de mudança/obra, uso do salão, garagem,
   pets, barulho), `faq.md` (uma pergunta por `## cabeçalho`), `handoff.md`.
   Escreva na linguagem que o morador usa de verdade — a busca é lexical.

3. 🟡 **`app/lib/tenants.server.ts`** — adicione **uma linha** ao array
   `INITIAL_TENANTS` (Passo 6): `{ slug: 'condominio-demo', name: 'Administradora Predial Horizonte (Demo)' }`.
   **Esta é a única mexida em código da tarefa** — destaque ela no PR pra revisão.
   Sem ela o motor rejeita o slug (`Unknown tenant`) e o simulador não acha o tenant.

4. 🟢 **`scripts/eval-motor.ts`** — adicione cenários no array `SCENARIOS` com
   `tenant: 'condominio-demo'` (Passo 5 do playbook, Opção A): um chamado claro
   (deve abrir chamado), uma pergunta de regra coberta pelo FAQ (deve responder),
   uma pergunta fora da base (deve escalar), um gatilho sensível (deve escalar).

## O que você NÃO toca (zona 🔴)

Nada do cérebro nem dos guard-rails. Especificamente, **não** edite:
`conversation.server.ts`, `app/lib/attendant/**`, `handoff.ts`, `lead.ts`,
`response.ts`, `validate.ts`, `auth.server.ts`. Se você *sentir* que precisa
mexer num deles pra vertical funcionar, **pare e fale com o Gabriel** — quase
sempre é sinal de que dá pra resolver por config/conhecimento.

> Nota honesta (do playbook, Passo 4c): bairros e termos de urgência são
> hardcoded pra SP em `app/lib/lead.ts`, e há um caminho especial só pra
> `assistencia-tecnica-demo` em `response.ts:91`. O `condominio-demo` **não** entra
> nesses caminhos — e tudo bem, não precisa. Não tente "consertar" isso nesta
> tarefa; se aparecer, anote no PR como observação.

## Critério de pronto (valide no simulador/eval)

Rode `/demo/chat?tenant=condominio-demo` (com `npm run dev`) e/ou
`npm run eval:motor`, e confira o checklist do Passo 5 do playbook:

- [ ] Saudação simples não escala à toa nem despeja todas as regras de uma vez.
- [ ] Pergunta coberta pelo FAQ (ex.: "posso fazer mudança no domingo?") é respondida com o conteúdo certo.
- [ ] Relato claro de problema (ex.: "vazou água na garagem") → abre chamado.
- [ ] Pergunta fora da base → escala (`no_knowledge_match`), não inventa.
- [ ] Gatilho sensível (ex.: "quero falar sobre a inadimplência do 302") → escala com a `humanMessage` do tenant.
- [ ] IA não promete nada do `neverPromise`.
- [ ] `npm run typecheck && npm test && npm run lint` — os três verdes.

## Como entregar

1. Branch: `git checkout -b feat/danilo-tenant-condominio`.
2. Commits pequenos e em Conventional Commits (ex.: `feat(tenant): base de conhecimento condominio-demo`).
3. Abra o PR. No corpo: o que fez em 2 linhas, o checklist acima marcado, e
   **destaque a linha do `INITIAL_TENANTS`** como a única mudança de código.
