# Playbook de Replicação — Hermes

> **O que é isto:** o manual repetível para colocar um novo cliente (ou um novo ramo/vertical) no ar no Hermes, do zero até atendendo no WhatsApp. Cada passo é marcado como **[só config]** (dá pra fazer sem programar, editando JSON/markdown ou pela tela `/configuracoes`) ou **[exige código]** (hoje precisa de um dev tocar em `.ts` + rebuild).
>
> **Princípio que rege tudo:** o motor (código) é único. O que muda entre clientes é **dado** — um JSON de config e uma pasta de documentos. A IA **propõe** (JSON), o balcão **valida e executa**. Guard-rails são determinísticos no código, nunca confiados ao prompt.
>
> Base factual: auditoria da superfície real de onboarding. Não invente arquivos além dos citados aqui.

---

## Mapa das 3 camadas de um cliente

Cada cliente ("tenant") vive em três camadas separadas, identificadas por um **slug** (ex.: `prestacon`):

| Camada | Onde fica | O que é | Muda por |
|---|---|---|---|
| **Config** | `config/tenants/<slug>.json` | Como a empresa atende: perfil, objetivos, ferramentas, guard-rails, escalação | **[só config]** — JSON ou tela `/configuracoes` |
| **Conhecimento** | `knowledge/<slug>/*.md` | A verdade da empresa: serviços, preços, FAQ, horários | **[só config]** — arquivos markdown |
| **Registro + acesso** | banco (Prisma/SQLite) + `INITIAL_TENANTS` no código | O tenant existe, o operador loga, o número de WhatsApp aponta pra cá | **[exige código]** (slug no array) + env |

O slug precisa casar em **três lugares**: nome do arquivo JSON, nome da pasta `knowledge/`, e a entrada em `INITIAL_TENANTS`. Formato válido: só `[a-z0-9-]` (minúsculas, números, hífen). Validado em `tenant-config.ts:61`, `tenants.server.ts:14` e `knowledge.server.ts:11`.

---

## Checklist — do zero até no ar

### Passo 0 — Escolher o slug **[só config]**
Escolha um identificador curto, minúsculo, com hífens: `padaria-do-ze`, `clinica-alfa`, `advocacia-souza`. Ele é permanente e aparece em todo lugar. Regex de validação: `/^[a-z0-9-]+$/`.

---

### Passo 1 — Coletar os dados do negócio e as perguntas mais frequentes **[só config]**
Esta é a etapa que **não é técnica** e determina a qualidade de tudo. Sente com o cliente (ou preencha por ele) e levante:

**Perfil**
- Nome oficial da empresa (como aparece pro cliente).
- Segmento em uma frase ("assistência técnica de eletrodomésticos", "escritório de contabilidade").
- Tom de voz (curto e cordial? formal? sem juridiquês?).
- Horário de atendimento (opcional, mas recomendado).
- Endereço/área de cobertura (opcional).

**O que a IA deve tentar fazer** (os "objetivos") — escolha entre os 5 fixos: tirar dúvidas, qualificar lead, agendar, abrir chamado, vender.

**A verdade da empresa** (vira a base de conhecimento):
- Lista de serviços e o que cada um resolve.
- Faixas de preço / política de preço (o que pode dizer, o que **não** pode cravar).
- As 10–20 perguntas que mais chegam (o FAQ real — peça o histórico de WhatsApp deles).
- Horários, prazos, como agendar, como enviar documento.

**Onde chamar humano** (guard-rails do ramo):
- Que assuntos são delicados demais pra IA responder sozinha (contrato, processo, reclamação grave, valores altos).
- O que a IA **nunca** pode prometer.
- A frase exata que o cliente ouve quando a conversa vai pra uma pessoa.

> **Regra de ouro:** se o cliente não sabe responder uma FAQ, a IA também não vai saber. A base de conhecimento é o teto de qualidade do atendente.

---

### Passo 2 — Preencher `config/tenants/<slug>.json` campo a campo **[só config]**
Crie o arquivo `config/tenants/<slug>.json`. Estrutura validada por `parseTenantConfig` (`tenant-config.ts:88`). Regras de validação que **quebram o load do config** se erradas:

- `businessProfile.name`, `.segment`, `.tone` — obrigatórios, string não-vazia.
- `knowledge.sourceDir` — obrigatório; `parseTenantConfig` só exige que seja **string não-vazia**. O formato `knowledge/<slug>` (regex `^knowledge/[a-z0-9-]+$`, `SAFE_SOURCE`) é validado **depois**, em `loadKnowledgeFromSource` (`knowledge.server.ts:29`), na hora de carregar a base. Ou seja: um `sourceDir` malformado **passa** no parse do config — ele só quebra quando o motor tenta buscar conhecimento (a IA fica sem base). Preencha exatamente `knowledge/<slug>` para não cair nessa armadilha silenciosa.
- `knowledge.sourcePolicy` — obrigatório; só aceita `answer_only_from_knowledge` **ou** `allow_general_smalltalk`.
- `objectives` e `tools` — precisam ser arrays (podem ser vazios).
- `escalationPolicy.defaultReason` e `.humanMessage` — obrigatórios, string não-vazia.
- Campos opcionais ausentes viram default seguro; não precisa incluí-los.

**Template comentado** (os comentários `//` são explicativos — **remova-os**, JSON não aceita comentário):

```jsonc
{
  "businessProfile": {
    "name": "Padaria do Zé",                       // nome que o cliente vê
    "segment": "padaria e confeitaria de bairro",  // segmento em 1 frase
    "tone": "simpático, direto e caloroso",         // tom de voz da IA
    "workingHours": "Seg a sáb, 6h às 20h; dom 6h às 12h",  // opcional
    "address": "Rua das Flores, 123 — atende bairro Centro" // opcional
  },

  // Objetivos: SOMENTE estes 5 valores são aceitos (enum fixo no código).
  // É ORIENTAÇÃO pra IA, não vira fluxo obrigatório.
  "objectives": ["tirar_duvidas", "qualificar_lead", "agendar"],

  "knowledge": {
    "sourceDir": "knowledge/padaria-do-ze",  // preencha exatamente knowledge/<slug>
    // answer_only_from_knowledge = não inventa fora dos docs (mais seguro)
    // allow_general_smalltalk    = pode bater papo geral além dos docs
    "sourcePolicy": "answer_only_from_knowledge"
  },

  // Ferramentas: catálogo FIXO no código (só 3 existem hoje). Aqui só
  // liga/desliga e limita. Inventar tool nova = [exige código].
  // Em limits, SÓ allowedCategories e requiredFields são impostos pelo
  // validador (validate.ts:113-131). Não coloque outros campos aqui esperando
  // que o código os honre.
  "tools": [
    {
      "name": "abrir_chamado",     // abrir_chamado | consultar_chamados | pedir_agendamento
      "enabled": true,
      "limits": {
        // categorias que a IA pode usar ao abrir chamado (o validador as impõe)
        "allowedCategories": ["encomenda", "reclamacao", "duvida", "outro"],
        "requiredFields": ["subject", "description"]  // campos obrigatórios no chamado
      }
    },
    { "name": "consultar_chamados", "enabled": true },
    { "name": "pedir_agendamento", "enabled": false }
  ],

  // GUARD-RAILS — aplicados pelo CÓDIGO (validador/handoff), não pelo prompt.
  "guardrails": {
    // Somado ao FORBIDDEN_CLAIMS global do validador. Se a IA prometer
    // algo aqui, a resposta é bloqueada e escala pra humano.
    "neverPromise": ["bolo pronto na hora sem encomenda", "entrega grátis garantida"],
    "forbiddenTopics": [],   // definido no schema, mas HOJE NÃO É USADO (ver atritos)
    "maxDiscountPercent": 0  // idem: schema tem, código ignora HOJE
  },

  // ESCALAÇÃO — quando chamar uma pessoa e o que dizer.
  "escalationPolicy": {
    // Palavras que forçam handoff. Somadas às SENSITIVE_PHRASES globais.
    // Normalizadas (minúsculas/sem acento) e casadas por palavra inteira.
    "triggers": ["reclamacao", "bolo de casamento", "encomenda grande"],
    "defaultReason": "tema_sensivel",   // rótulo do motivo (aparece pro atendente)
    // Frase EXATA que o cliente recebe quando a IA passa pra humano:
    "humanMessage": "Vou chamar alguém da equipe pra te atender com todo cuidado."
  },

  // Regras livres — orientação extra pra IA (texto solto). Não é validado/executado,
  // só entra no prompt. Uma por item.
  "extraRules": [
    "Sempre confirme o sabor e a data quando for encomenda.",
    "Nunca combine preço de bolo grande sem confirmar com a equipe."
  ]
}
```

> **Sobre `limits` das tools:** o tipo `ToolConfig` (`tenant-config.ts:20-25`) até declara mais campos (`requireConfirmation`, `maxPriority`), mas **o código não os lê** — a busca por eles em `app/` não retorna nenhum uso. Só `allowedCategories` e `requiredFields` são efetivamente impostos por `validateAction` (`validate.ts:113-131`). Não os inclua no template achando que são guard-rail: são a mesma classe de "campo schema-only" que `forbiddenTopics`/`maxDiscountPercent`.

> **Atalho pela tela:** depois que o tenant existe (Passo 6) e o operador loga, quase tudo isto é editável em `/configuracoes` sem tocar no arquivo: perfil, objetivos, política de resposta, liga/desliga de ferramentas, escalação, "nunca prometer" e regras extras. **O que a tela NÃO edita** (fica preservado do JSON, mas exige editar o arquivo): `knowledge.sourceDir`, os `limits` das ferramentas (`allowedCategories`, `requiredFields`), `forbiddenTopics` e `maxDiscountPercent`.

---

### Passo 3 — Montar `knowledge/<slug>/` **[só config]**
Crie a pasta `knowledge/<slug>/` e coloque arquivos **markdown** (`.md`). Convenções reais do código (`knowledge.server.ts`):
- Só arquivos `.md` são lidos; carregados em **ordem alfabética** do nome.
- O **título** de cada doc é a primeira linha que começa com `# ` (senão, vira o nome do arquivo).
- Sem limite rígido de quantidade; a busca é lexical (por palavra), então **use os termos que o cliente usa** de verdade.

**Estrutura recomendada** (espelha os tenants existentes `prestacon`/`assistencia-tecnica-demo`; nomes são convenção, não obrigatórios):

```
knowledge/padaria-do-ze/
├── perfil_do_negocio.md     # quem é a empresa, horário, cobertura, como falar
├── servicos_precos.md        # o que vende, faixas de preço, o que NÃO cravar
├── faq.md                    # as perguntas reais, uma por "## pergunta"
├── politica_agendamento.md   # como encomenda/agenda, prazos (se aplicável)
├── tom_de_voz.md             # exemplos de como falar (reforça o "tone")
└── handoff.md                # quando/como passar pra humano (reforça escalação)
```

**Padrão de conteúdo** (baseado em `knowledge/prestacon/faq.md` e `perfil_do_negocio.md`):

```markdown
# FAQ — Padaria do Zé

## Vocês fazem bolo de aniversário?
Sim! Fazemos sob encomenda com no mínimo 2 dias de antecedência. O sabor e o
tamanho a gente combina na hora do pedido.

## Qual o preço do pão na chapa?
Trabalhamos com pães frescos saindo do forno ao longo do dia. Para valores
atualizados, é melhor passar aqui ou perguntar que a gente confirma.

## Vocês entregam?
Entregamos no bairro Centro. Para outros bairros, confirmamos disponibilidade.
```

Diretrizes:
- **Uma pergunta por `## cabeçalho`** no FAQ — casa melhor com a busca lexical.
- Escreva respostas curtas, na linguagem do cliente, do jeito que o dono responderia.
- Se algo **não pode ser dito** (preço fechado, promessa), deixe isso explícito no doc e no `neverPromise` do JSON.
- Se a política é `answer_only_from_knowledge`, o que **não estiver escrito aqui** a IA não responde — ela escala. Cubra o essencial.

---

### Passo 4 — Definir guard-rails e escalação do ramo **[misto]**
Aqui mora a segurança do produto. Divide-se em três níveis:

**a) Configurável por tenant — [só config]** (faça isto sempre):
- `escalationPolicy.triggers` — palavras do ramo que forçam humano (ex.: contabilidade usa `fiscalizacao`, `multa`; padaria usa `bolo de casamento`, `reclamacao`).
- `guardrails.neverPromise` — promessas proibidas do ramo.
- `escalationPolicy.humanMessage` — a frase de transição.
- `tools[].limits` — o que a IA pode fazer ao abrir chamado. **Só `allowedCategories` e `requiredFields` são efetivamente impostos** (`validate.ts:113-131`); os demais campos do tipo não são lidos hoje.

**b) Global no código, herdado por todo tenant — [contexto, não mexer]:**
- Frases que sempre pedem humano: `humano`, `atendente`, `pessoa`, `falar com alguem`, `alguem do time` (`handoff.ts:7`).
- Temas sempre sensíveis: `contrato`, `lgpd`, `juridico`, `processo`, `dados pessoais` (`handoff.ts:15`). Estes **valem pra todos** — os `triggers` do tenant são **somados** a eles, nunca substituem.
- Sem match na base → escala automaticamente (`no_knowledge_match`).

**c) O que ainda é hardcoded e pode não servir ao ramo — [exige código]** (atenção ao replicar fora de assistência técnica):
- `app/lib/lead.ts` — lista de **bairros de São Paulo** e termos de urgência em pt-BR fixos. Se o cliente é de outra cidade, a extração de localização não vai reconhecer os bairros.
- `app/lib/response.ts:91` — há um ramo especial `if (tenantSlug === 'assistencia-tecnica-demo')` que muda a resposta (pede "bairro, equipamento e o que aconteceu"). Um novo tenant **não** entra nesse caminho; cai no genérico ("me conta seu processo e o que precisa resolver").
- Idioma (português) e canal (WhatsApp) estão colados no prompt/regras globais (`rules.ts:6`, `summary.server.ts:23`, `claude-cli.server.ts:40`).

> Para a maioria dos ramos de serviço em português no Brasil, os itens (c) não bloqueiam o go-live — mas documente pro cliente que "detecção de bairro" hoje é enviesada a SP.

---

### Passo 5 — Validar no simulador / banco de provas **[só config]**
Antes de ligar o WhatsApp, teste o cérebro pelo **mesmo caminho** de uma mensagem real (config → regras → knowledge → retrieval → handoff → cérebro validado), sem tocar o banco.

**Opção A — banco de provas (eval):** existe `scripts/eval-motor.ts` rodado por `npm run eval:motor` (config em `vitest.eval.config.ts`). Ele:
- Roda cenários de atendimento e imprime as respostas pra **revisão humana**.
- Trava invariantes: escala quando deve, não vaza segredo, não promete o proibido, abre chamado em relato claro.
- Usa o provider real (`ATTENDANT_PROVIDER=claude_cli`) por padrão — exige Claude CLI logado na máquina.

Para o novo tenant, **adicione cenários** no array `SCENARIOS` de `eval-motor.ts` apontando `tenant: '<slug>'` com as mensagens típicas do ramo e as expectativas (`espera: { escala, abreChamado, naoContem }`).

**Opção B — simulador na tela (Demo pública):** rode `npm run dev` e abra a Demo em `/demo?tenant=<slug>` — é uma **rota pública, sem login**. Ela seleciona o tenant pelo query param `?tenant=<slug>` (resolvido por `resolveTenantSlug` contra `INITIAL_TENANTS`; se o slug for desconhecido, cai no default `dgc`). A conversa roda pelo **mesmo `processIncomingMessage`**, com `channel = simulator` e `contactId = demo-user`. Bom para ver a conversa fluindo do ponto de vista do cliente.

> O **login de operador** (`requireOperator`) só é exigido nas telas internas `/atendente` e `/dashboard` — **não** no simulador da Demo. Não confunda o gate do balcão com o banco de provas.

**Checklist de validação:**
- [ ] Saudação simples não escala à toa nem "despeja o cardápio".
- [ ] Pergunta coberta pelo FAQ é respondida com o conteúdo certo (mede o retrieval).
- [ ] Pergunta fora da base → escala (`no_knowledge_match`), não inventa.
- [ ] Gatilho sensível do ramo → escala com a `humanMessage` do tenant.
- [ ] IA não promete nada do `neverPromise`.
- [ ] `npm run typecheck`, `npm test` e `npm run lint` passam (obrigatório antes de "pronto").

---

### Passo 6 — Registrar o tenant e o operador **[exige código + banco]**
Para o tenant existir de fato (aparecer no login, no dossiê, no dashboard):

1. **[exige código]** Adicione o slug ao array `INITIAL_TENANTS` em `app/lib/tenants.server.ts:8`:
   ```ts
   export const INITIAL_TENANTS = [
     { slug: 'dgc', name: 'DGC Hub' },
     { slug: 'assistencia-tecnica-demo', name: 'ResolveTech Assistência (Demo)' },
     { slug: 'prestacon', name: 'Prestacon Contabilidade' },
     { slug: 'padaria-do-ze', name: 'Padaria do Zé' },   // ← novo
   ] as const
   ```
   > Este é o atrito nº 1 do produto: **adicionar cliente exige editar código e rebuild.** `processIncomingMessage` **rejeita slug desconhecido** — `findTenantInput()` não acha o tenant e a função lança `Unknown tenant: <slug>` (`conversation.server.ts`).

2. **[semi-automático]** O operador (login do atendente) é criado sozinho na **primeira visita ao `/login`** por `ensureSeedOperators` (`operators.server.ts:71`): cria um operador com `username = <slug>` e senha = `OPERATOR_SEED_PASSWORD` (do `.env`). Um operador por tenant no MVP.

3. Rebuild/redeploy para o novo slug entrar no `INITIAL_TENANTS`.

---

### Passo 7 — Ligar no WhatsApp **[só config, via env]**
O canal WhatsApp (Meta Cloud API) está desligado por padrão (tudo vazio no `.env` = só o simulador roda). Para ligar o novo tenant:

1. Configure as credenciais da Meta no `.env` (passo a passo em `docs/whatsapp-setup.md`):
   - `WHATSAPP_VERIFY_TOKEN` — string que você inventa, a mesma no painel da Meta.
   - `WHATSAPP_APP_SECRET` — valida a assinatura do webhook.
   - `WHATSAPP_ACCESS_TOKEN` — token da Cloud API.
   - `WHATSAPP_PHONE_NUMBER_ID` — ID do número que envia/recebe.
2. **Mapeie o número do cliente ao slug** em `WHATSAPP_NUMBER_MAP` — o par `phoneId:slug`:
   ```
   WHATSAPP_NUMBER_MAP="111111:prestacon,222222:padaria-do-ze"
   ```
   `resolveTenantSlugByPhoneNumberId` (`whatsapp.server.ts:93`) usa isto pra saber de qual empresa é a mensagem que chegou.
3. O webhook (`app/routes/webhook.whatsapp.tsx`) já reusa `processIncomingMessage`. Nada de código novo — só env.

> **Atrito:** o mapa número→tenant é **string de env estática**. Trocar/adicionar número exige editar `.env` e reiniciar; não há tela nem tabela pra isso.

---

### Passo 8 — Modo sombra → automático **[operacional]**
Vá ao ar com rede de segurança, não de uma vez:

1. **Sombra:** deixe a IA respondendo mas com o operador humano de plantão no `/atendente`, acompanhando a fila de handoff e o dossiê de cada contato. A IA já escala sozinha nos casos sensíveis; o humano assume os limítrofes.
2. **Ajuste:** cada conversa ruim vira melhoria em **dado**, não em código — falta uma FAQ? adiciona `.md`. Escala demais? afrouxa `sourcePolicy` pra `allow_general_smalltalk` ou revisa `triggers`. Promete errado? adiciona a `neverPromise`.
3. **Automático:** quando a fila de handoff estabiliza e as respostas estão boas, o humano vira exceção (só os casos escalados). O cliente está no ar.

---

## Resumo: o que é config vs. o que exige código

| Ação | Classificação | Onde |
|---|---|---|
| Criar/editar o JSON do tenant | **[só config]** | `config/tenants/<slug>.json` ou `/configuracoes` |
| Montar a base de conhecimento | **[só config]** | `knowledge/<slug>/*.md` |
| Definir triggers, neverPromise, humanMessage, tools on/off | **[só config]** | JSON / tela |
| Editar `sourceDir`, `limits` das tools, `forbiddenTopics`, `maxDiscountPercent` | **[só config, mas só no arquivo]** | JSON (tela não expõe) |
| Rodar o eval / simulador | **[só config]** | `npm run eval:motor` / `/demo?tenant=<slug>` |
| Mapear número WhatsApp → tenant | **[só config, via env]** | `.env` (`WHATSAPP_NUMBER_MAP`) |
| **Registrar o slug pra o tenant existir** | **[exige código]** | `INITIAL_TENANTS` em `tenants.server.ts` + rebuild |
| Adicionar uma ferramenta/objetivo novo | **[exige código]** | enums `ToolName`/`TenantObjective` + validador + tela |
| Adaptar bairros/urgência a outra cidade | **[exige código]** | `app/lib/lead.ts` |
| Resposta especial por ramo (tipo assistência) | **[exige código]** | `app/lib/response.ts` |
| Trocar idioma/canal | **[exige código]** | `rules.ts`, `summary.server.ts`, `claude-cli.server.ts` |

---

## Atritos que precisam virar ferramenta/automação
Estes são os pontos que hoje exigem dev/rebuild e deveriam virar UI ou dado (pra escalar a replicação):

1. **`INITIAL_TENANTS` hardcoded** — adicionar cliente exige editar `.ts` + rebuild. Deveria listar tenants do banco. **É o maior bloqueio de replicação self-service.**
2. **Wizard de onboarding ausente** — não há tela "novo cliente" (criar tenant, subir docs, configurar, mapear número). Tudo é manual/arquivo.
3. **`WHATSAPP_NUMBER_MAP` em env** — mapa número→tenant é string estática; trocar número = editar `.env` + restart. Deveria ser tabela por tenant.
4. **`sourceDir` e `limits` de tools sem UI** — `/configuracoes` não os edita; obriga a mexer no JSON. Onboarding de vertical novo passa pelo arquivo.
5. **Sem versionamento/backup do config** — `saveTenantConfig` sobrescreve sem histórico nem rollback; um save inválido pode corromper (mitigado por revalidar antes de gravar, mas sem trilha).
6. **Sem migração automática de config** — adicionar campo novo ao `TenantConfig` obriga editar **todos** os JSONs à mão.
7. **Campos schema-only** — `forbiddenTopics`, `maxDiscountPercent` e, dentro de `tools[].limits`, `requireConfirmation` e `maxPriority` existem no tipo mas o código **não os usa**. Ou implementa, ou remove (evita falsa sensação de guard-rail).
8. **Amarrações culturais (pt-BR/SP)** — bairros de SP, termos de urgência, idioma e canal colados no código. Deveriam virar campos do `TenantConfig` (`language`, `localidades`, `urgencyTerms`, `nextStepPrompt`) pra replicar fora do nicho atual sem refactor.
9. **Um operador por tenant** — modelo 1-para-1; sem múltiplos atendentes por empresa nem RBAC. Vira gargalo quando o cliente tem equipe.
10. **Sem audit trail** — quem editou qual config/quando não é registrado; relevante pra LGPD e pra suporte multi-cliente.

> **Recomendação de sequência de investimento:** resolver (1) + (2) + (3) primeiro (descoberta dinâmica de tenant + wizard + número por tenant) transforma este playbook de "manual de dev" em "onboarding de vendas". Depois (8) para abrir novos ramos/idiomas sem tocar código.
