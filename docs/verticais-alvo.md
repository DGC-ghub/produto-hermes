# Verticais-alvo do Hermes

**O que o Hermes faz hoje (a régua honesta).** Um atendente de WhatsApp por IA que: responde FAQ via RAG lexical sobre uma base de conhecimento em markdown (`knowledge/<slug>/`), qualifica lead de forma determinística (extrai necessidade, urgência e bairro), abre e consulta chamados, e escala pra humano com guard-rails determinísticos (a IA propõe JSON, o balcão valida e executa). Tudo é dirigido por um `TenantConfig` JSON por empresa. **A IA nunca toca o banco.**

Este documento ranqueia os ramos que melhor se encaixam nessa régua **hoje**, e é honesto sobre o que já existe versus o que exige código novo.

---

## O que pesa no "encaixe" (critérios)

Um ramo encaixa bem quando:

1. **Volume alto de perguntas repetitivas** — FAQ é o coração do produto; se o cliente vive respondendo as mesmas 20 perguntas, o RAG resolve.
2. **A conversa vira agendamento ou chamado** — as duas ações que o motor entende (`abrir_chamado`, `pedir_agendamento`).
3. **Qualificar lead tem valor comercial** — negócio onde saber "quem é, o que precisa, quão urgente" já adianta a venda.
4. **A escalação pra humano é aceitável, não uma falha** — o dono não espera que a IA feche negócio sozinha; quer filtro e triagem.
5. **Baixo risco regulatório na resposta automática** — quanto mais uma resposta errada custa (jurídico, saúde, dinheiro), mais o guard-rail precisa ser conservador (o que o motor já faz: escala em vez de arriscar).

E encaixa **mal** quando: precisa de integração com sistema externo em tempo real (estoque, agenda de verdade, ERP), precisa cobrar/receber pagamento no chat, ou depende de resposta clínica/jurídica precisa que não pode errar.

**Nota importante sobre agendamento:** a tool `pedir_agendamento` está **desligada nos tenants existentes** (confirmado nos três configs — `dgc`, `assistencia-tecnica-demo` e `prestacon` trazem `pedir_agendamento` com `enabled: false`) e, mais fundo que o flag, **o motor não integra com nenhuma agenda real** — ele registra a intenção de agendar e escala pro humano marcar. Para verticais cujo "caso matador" é agendar, isso é um limite real, não um detalhe. Considere-o em cada nota abaixo.

---

## Ranking

| # | Vertical | Encaixe | Caso de uso matador | Maior objeção/risco |
|---|----------|:---:|---------------------|---------------------|
| 1 | **Contabilidade** | 5 | Filtrar dúvida fiscal repetitiva; abrir chamado de documento/guia; agendar reunião com contador | Respostas fiscais erradas — mitigado por `answer_only_from_knowledge` + escala em tema sensível |
| 2 | **Assistência técnica / manutenção** | 5 | Triagem "o que quebrou + onde"; abrir chamado; orçar visita | Cliente quer preço fechado no chat (a IA não pode) |
| 3 | **Clínicas / odonto / estética** | 4 | FAQ (preços, convênios, preparo) + pedido de agendamento | Agendamento real não existe hoje; dado de saúde é sensível (LGPD) |
| 4 | **Escola / curso / autoescola** | 4 | FAQ de matrícula, valores, horários; qualificar interessado | Sazonalidade forte; ticket baixo por lead |
| 5 | **Imobiliária / administradora** | 4 | Qualificar interesse em imóvel; abrir chamado de manutenção (locação) | Precisa de catálogo de imóveis vivo; integração com portais |
| 6 | **Salão / barbearia / pet grooming** | 4 | FAQ de serviços/preços + pedido de horário | Negócio É agendar; sem agenda real, entrega meia-boca |
| 7 | **Advocacia** | 3 | Triagem inicial de caso; qualificar e agendar consulta | Alto risco regulatório (OAB, não pode "dar consulta"); precisa escalar quase tudo |
| 8 | **Oficina mecânica / funilaria** | 4 | Triagem "carro + sintoma"; abrir chamado; orçar | Preço só após ver o carro; muito parecido com assistência técnica |
| 9 | **Pet shop / clínica veterinária** | 4 | FAQ (banho/tosa, vacinas) + agendamento + chamado | Mistura varejo (estoque) com serviço (agenda) |
| 10 | **E-commerce pequeno** | 3 | FAQ (prazo, troca, rastreio); abrir chamado de pós-venda | Rastreio/estoque exige integração; sem isso é raso |
| 11 | **Condomínio / administradora predial** | 4 | Abrir/consultar chamado (portaria, manutenção); FAQ de regras | Nicho de nicho; venda pulverizada |
| 12 | **Consultório psicologia / terapias** | 3 | FAQ + agendamento de primeira sessão | Altíssima sensibilidade; conteúdo clínico proibido pra IA |

---

## Detalhe por vertical

### 1. Contabilidade — encaixe 5

**Por que encaixa.** É a Prestacon: o produto nasceu aqui e o tenant real (`prestacon`) já está montado e testado. Contabilidade é FAQ pura o dia inteiro (prazo de imposto, quais documentos mandar, como emitir guia, dúvida sobre regime tributário) e tudo que é análise séria vira reunião com contador — ou seja, agendar/escalar é o comportamento certo, não uma falha.

**Caso matador.** Filtrar as dúvidas repetitivas (que hoje consomem a equipe), abrir chamado de "preciso da guia X" / "mandei o documento Y", e empurrar qualquer decisão fiscal pra uma reunião humana.

**O que reusa (honesto).** Tudo. O tenant `prestacon.json` já existe com objectives, `neverPromise` ("valor fechado sem análise", "redução de imposto garantida"), triggers de escalação ("contrato", "processo judicial", "multa", "fiscalizacao") e extraRules ("explique sem juridiquês", "nunca comente outros clientes"). É a vertical de menor esforço porque o esforço já foi feito.

**Riscos/objeções.** Resposta fiscal errada tem custo real. Mitigação já no motor: `sourcePolicy` restrito à base e escalação determinística em tema sensível. O risco residual é a base de conhecimento estar incompleta/desatualizada — problema de conteúdo, não de código.

### 2. Assistência técnica / manutenção — encaixe 5

**Por que encaixa.** Já existe o tenant `assistencia-tecnica-demo` funcionando. O fluxo natural — "meu equipamento X parou, o que faço?" → coletar bairro + equipamento + sintoma → abrir chamado — bate exatamente com o que o motor faz. A extração determinística de lead já detecta **urgência** ("parou", "nao funciona", "urgente") e **bairro**.

**Caso matador.** Triagem 24/7: o cliente descreve o problema fora do horário, a IA coleta o essencial e abre o chamado; de manhã o técnico já pega a fila priorizada por urgência.

**O que reusa (honesto).** O tenant demo, a extração de urgência (`URGENCY_TERMS` em `app/lib/lead.ts`) e a de bairro. **Cuidado honesto:** a lista de bairros (`NEIGHBORHOODS`) está **hardcoded com bairros genéricos de São Paulo** no código, não no config. Para um cliente real de outra cidade, os bairros dele não são reconhecidos até isso virar config — é um débito conhecido (auditoria confirmou). Funciona pra demo; para produção numa cidade específica exige mexer no código ou aceitar que o bairro venha só pela IA.

**Riscos/objeções.** O cliente vai querer preço no chat. O guard-rail `neverPromise` do tenant já cobre isso — em `assistencia-tecnica-demo.json` o `neverPromise` é `["conserto garantido", "preço fechado sem avaliação"]`, então a IA orienta e escala em vez de chutar valor.

### 3. Clínicas / odonto / estética — encaixe 4

**Por que encaixa.** Volume gigante de perguntas repetidas (aceita convênio X? quanto custa limpeza? como é o preparo?) e o desfecho quase sempre é marcar horário. FAQ + qualificação + intenção de agendamento é o miolo do produto.

**Caso matador.** Responder as perguntas de sempre e capturar o pedido de agendamento com os dados certos, entregando pro balcão marcar.

**O que reusa (honesto).** Motor, RAG, qualificação, escalação. **Limite real:** o "matador" é agendar, e a tool `pedir_agendamento` está **desligada e sem integração com agenda**. Entrega hoje = "registrei que você quer marcar, o time confirma" — não é marcação de verdade. Para virar diferencial, precisa de integração com a agenda do cliente (esforço médio-alto, código novo).

**Riscos/objeções.** Dado de saúde é sensível (LGPD) e a auditoria apontou que **não há audit log** de acesso a dado pessoal. Nada de conteúdo clínico pela IA — tem que escalar. Positivamente, escalar é o comportamento padrão do motor.

### 4. Escola / curso / autoescola — encaixe 4

**Por que encaixa.** Período de matrícula gera enxurrada das mesmas perguntas (valor, horário, documentação, tem vaga?). Qualificar interessado ("quer qual curso, pra quando") tem valor comercial direto.

**Caso matador.** Absorver o pico de matrícula sem contratar gente: FAQ + captura de lead quente pro comercial ligar.

**O que reusa (honesto).** Motor, RAG, qualificação de lead, escalação. Encaixe quase 100% no que existe — não depende de agendamento nem integração.

**Riscos/objeções.** Sazonalidade: valor concentrado em janelas do ano, uso baixo no resto. Ticket por lead costuma ser menor — precisa de volume pra justificar. Bom vertical, negócio de volume.

### 5. Imobiliária / administradora — encaixe 4

**Por que encaixa.** Dois fluxos: (a) locação/venda — qualificar interesse ("quer comprar/alugar, faixa de preço, região"); (b) administração de locação — inquilino abre chamado de manutenção. O segundo é literalmente `abrir_chamado`.

**Caso matador.** Para administradora de aluguéis: portal de chamados do inquilino via WhatsApp (vazamento, reparo) com triagem e fila — reusa quase tudo.

**O que reusa (honesto).** Motor, chamados, qualificação. **Limite:** o lado de venda quer catálogo de imóveis vivo (o que está disponível agora), e o RAG é sobre markdown estático — desatualiza rápido para estoque. Bom para o lado de manutenção/administração; raso para o lado de vitrine sem integração.

**Riscos/objeções.** Expectativa de "mostrar imóveis" que o produto não faz. Vender pelo ângulo de **atendimento/chamado**, não de vitrine.

### 6. Salão / barbearia / pet grooming — encaixe 4

**Por que encaixa.** FAQ de serviços e preços + a dor nº1 do dono: agendar sem ficar preso no celular.

**Caso matador.** "Quero cortar cabelo sábado de manhã" → captura e marca.

**O que reusa (honesto).** RAG e qualificação, sim. Mas o negócio **É** agendar, e sem agenda real integrada a entrega fica aquém da expectativa (mesmo limite da tool `pedir_agendamento` desligada). Rebaixaria pra 3 se não fosse pela simplicidade da base de FAQ. **Priorize só depois de existir agendamento de verdade.**

**Riscos/objeções.** Cliente compara com apps de agendamento prontos (que marcam de fato). Sem integração de agenda, o Hermes perde a comparação direta aqui.

### 7. Advocacia — encaixe 3

**Por que encaixa.** Escritório recebe muito contato de triagem ("tenho um caso de X, vocês pegam?") e a saída certa é qualificar e marcar consulta.

**Caso matador.** Triagem de primeiro contato: separar quem é caso do escritório de quem não é, e agendar consulta com o advogado.

**O que reusa (honesto).** Motor e escalação — e aqui a **escalação agressiva é uma vantagem**: quase tudo deve virar humano. Os triggers de tema sensível ("contrato", "processo", "juridico") já estão nos `SENSITIVE_PHRASES` globais do handoff, então o motor já escala sozinho nesses termos.

**Riscos/objeções.** Alto risco regulatório: IA não pode dar orientação jurídica (OAB, exercício da profissão). O produto vira "recepcionista/triador", não "consultor" — o que reduz o valor percebido. Encaixe técnico ok, encaixe comercial limitado ao topo de funil.

### 8. Oficina mecânica / funilaria — encaixe 4

**Por que encaixa.** Gêmeo da assistência técnica: "meu carro faz barulho X" → coletar carro + sintoma → abrir chamado / orçar visita. A extração de urgência já ajuda em parte dos sintomas ("parou", "nao funciona").

**Caso matador.** Triagem de sintoma fora do horário e agendamento de entrada do veículo.

**O que reusa (honesto).** Praticamente o mesmo playbook da assistência técnica (nº 2), incluindo o mesmo débito de bairros hardcoded. **Cuidado honesto:** os termos de urgência (`URGENCY_TERMS`) são uma lista fixa em pt-BR — `['urgente', 'hoje', 'agora', 'parou', 'nao funciona', 'sem funcionar']` — e não são configuráveis por tenant. Um sintoma típico de oficina como **"não liga" hoje NÃO é detectado** como urgência (não está na lista); só cai como urgência se o cliente disser "parou" ou "não funciona". Ou seja: a detecção ajuda, mas o vocabulário automotivo específico ficaria de fora até `URGENCY_TERMS` virar config. Um tenant de oficina é adaptação de um tenant que já existe, mas com esse débito em mente.

**Riscos/objeções.** Preço só depois de ver o carro — coberto pelo mesmo tipo de guard-rail `neverPromise` que cobre "preço fechado sem avaliação" na assistência técnica.

### 9. Pet shop / clínica veterinária — encaixe 4

**Por que encaixa.** Combina FAQ (banho e tosa, vacinas, horários), agendamento e chamado (emergência veterinária → escalar). Alto volume de WhatsApp no varejo pet.

**Caso matador.** FAQ + captura de agendamento de banho/tosa e triagem de urgência veterinária pra escalar.

**O que reusa (honesto).** Motor, RAG, qualificação, escalação. Mesmo limite de agendamento sem agenda real. O lado "loja" (tem tal ração em estoque?) precisaria de integração — raso sem ela.

**Riscos/objeções.** Emergência clínica animal é sensível; tem que escalar rápido (o motor já faz em ausência de match e em termos sensíveis). Mistura varejo+serviço dilui o foco.

### 10. E-commerce pequeno — encaixe 3

**Por que encaixa.** Pós-venda é FAQ repetitivo (prazo, troca, "cadê meu pedido"). Abrir chamado de troca/defeito bate com o motor.

**Caso matador.** Atendimento pós-venda: FAQ de política + abertura de chamado de troca/reembolso.

**O que reusa (honesto).** Motor e chamados. **Limite forte:** "cadê meu pedido" e "tem em estoque" exigem integração com a plataforma de e-commerce/logística — sem isso, a IA só sabe o que está no markdown, e o cliente quer rastreio ao vivo. Fica raso sem integração, por isso 3.

**Riscos/objeções.** Expectativa de rastreamento em tempo real que o produto não entrega hoje. Muita concorrência de chatbots de e-commerce prontos.

### 11. Condomínio / administradora predial — encaixe 4

**Por que encaixa.** Morador abre chamado o tempo todo (lâmpada queimada, barulho, vazamento na área comum) e faz perguntas de regra (horário de mudança, uso do salão de festas). É `abrir_chamado` + FAQ, quase sob medida.

**Caso matador.** Canal único de chamados do condomínio via WhatsApp, com triagem e fila pro síndico/zeladoria.

**O que reusa (honesto).** Motor, chamados (incluindo o dedup por similaridade de assunto em `ticket.ts`, útil quando três moradores reportam o mesmo vazamento), FAQ. Encaixe alto no que existe.

**Riscos/objeções.** Venda pulverizada (cada condomínio decide separado, ticket pequeno) — melhor vendido via administradora que gerencia muitos prédios (aí o multi-tenant ajuda).

### 12. Consultório psicologia / terapias — encaixe 3

**Por que encaixa.** FAQ (valores, como funciona, presencial/online) + agendar primeira sessão.

**Caso matador.** Recepção da primeira consulta: responder o básico e capturar o pedido de sessão.

**O que reusa (honesto).** Motor, FAQ, escalação. Depende de agendamento (não existe real) e o conteúdo é sensibilíssimo.

**Riscos/objeções.** Sensibilidade máxima: nada de conteúdo clínico/aconselhamento pela IA, e cuidado redobrado com LGPD (sem audit log hoje). O produto só pode ser recepcionista. Encaixe estreito.

---

## Padrão que emerge do ranking

Três "arquétipos" cobrem quase tudo:

- **Arquétipo Chamado (encaixe máximo hoje):** assistência técnica, oficina, condomínio, imobiliária-locação, pós-venda. O desfecho é abrir/consultar chamado — **exatamente o que o motor executa de verdade**. Não depende de nenhuma integração externa. É onde o Hermes já entrega 100% sem código novo além de config.

- **Arquétipo Agenda (encaixe alto, mas limitado por débito):** clínicas, salão, pet, vet, escola, psicologia. O desfecho é marcar horário. Entrega bem a parte de FAQ+qualificação, mas o "marcar" é hoje só intenção + escala pro humano (a tool `pedir_agendamento` vem desligada nos tenants existentes e, mais fundo, não há integração de agenda). Vira 5 quando `pedir_agendamento` virar integração real.

- **Arquétipo Conhecimento+Triagem (encaixe alto, risco regulatório):** contabilidade, advocacia. Volume de FAQ enorme, escalação agressiva é feature. Contabilidade é o topo porque o tenant já existe e o risco é gerenciável; advocacia limita-se a topo de funil.

**Conclusão prática:** o Hermes é mais forte, hoje, nos ramos do **Arquétipo Chamado** — porque o desfecho que ele executa de fato (abrir chamado) já está pronto, sem depender de integração externa nenhuma.

---

## Ordem de ataque recomendada

Depois de contabilidade (Prestacon, o 1º cliente), atacar **2 verticais**, nesta ordem:

### 1º — Assistência técnica (e o clone imediato: oficina mecânica)

**Por quê.** É o menor esforço com maior prontidão: o tenant demo **já existe**, a extração de urgência/bairro já foi construída pra esse caso, e o desfecho (abrir chamado) é executado de verdade — sem depender de agenda ou integração externa. É o Arquétipo Chamado no seu estado mais maduro. Oficina mecânica é praticamente o mesmo tenant com vocabulário trocado, então um cliente valida dois nichos.

**Esforço honesto.** Baixo. Dois débitos a limpar antes de um cliente real fora de SP: os **bairros hardcoded** em `app/lib/lead.ts` (mover pra config ou aceitar detecção só pela IA) e os **termos de urgência hardcoded** (`URGENCY_TERMS`) — que hoje não cobrem vocabulário automotivo como "não liga" e também deveriam virar config por tenant. Fora isso, é preencher config + montar a base de conhecimento do cliente.

### 2º — Condomínio / administradora predial

**Por quê.** Também Arquétipo Chamado puro — abre/consulta chamado é o fluxo central, e o **dedup de chamados** (`ticket.ts`) brilha quando vários moradores reportam o mesmo problema. Não depende de agendamento nem de estoque/integração. E o multi-tenant do produto casa com o modelo de negócio: vender pra **uma administradora** que gerencia dezenas de prédios = vários tenants de um só contrato, o que resolve a objeção de "ticket pequeno".

**Esforço honesto.** Baixo-médio. Nenhuma feature nova de motor; o trabalho é config + base de conhecimento (regras do condomínio) + eventualmente pensar o onboarding de múltiplos prédios sob uma administradora (hoje `INITIAL_TENANTS` é hardcoded e adicionar tenant novo exige rebuild — auditoria confirmou; é o atrito real a resolver antes de escalar clientes).

### Por que NÃO começar pelo Arquétipo Agenda ainda

Clínicas, salão e pet têm demanda óbvia, mas o "caso matador" deles é **agendar de verdade**, e hoje `pedir_agendamento` está desligada (nos três tenants existentes) e sem integração com agenda. Vender agendamento sem entregar agendamento gera decepção. **Guardar essas verticais para depois** de investir na integração de agenda — aí viram alvos de encaixe 5 e há muito mercado.

### Resumo da ordem

1. **Contabilidade** (Prestacon — já em andamento)
2. **Assistência técnica + oficina** (Arquétipo Chamado maduro; tenant demo pronto; débitos: bairros e termos de urgência hardcoded)
3. **Condomínio/administradora** (Arquétipo Chamado; multi-tenant casa com o negócio; débito: onboarding dinâmico de tenant)
4. *(Depois de integrar agenda)* Arquétipo Agenda: clínicas, salão, pet, escola

---

## Débitos que travam a replicação (o que resolver conforme escala)

Honestidade final — o motor é ~85% genérico, mas estes pontos, confirmados na auditoria, precisam cair para replicar sem dor:

- **Bairros/localização hardcoded** (`app/lib/lead.ts`, lista de SP) — bloqueia clientes de outras cidades no Arquétipo Chamado. Migrar pra `TenantConfig`.
- **Termos de urgência hardcoded** (`URGENCY_TERMS` em `app/lib/lead.ts`: `['urgente', 'hoje', 'agora', 'parou', 'nao funciona', 'sem funcionar']`) — lista fixa em pt-BR, não configurável; deixa de fora vocabulário específico de cada vertical (ex.: "não liga" numa oficina). Migrar pra `TenantConfig` (ex.: `escalationPolicy.urgencyTerms[]`).
- **`INITIAL_TENANTS` hardcoded** (`app/lib/tenants.server.ts`) — adicionar cliente exige rebuild; não há onboarding self-service. É o gargalo #1 pra escalar número de clientes.
- **Mapa WhatsApp→tenant por env** (`WHATSAPP_NUMBER_MAP`) — estático, exige redeploy por cliente novo.
- **Agendamento não integrado** (`pedir_agendamento` desligada nos tenants existentes e, mais fundo, sem integração de agenda) — trava todo o Arquétipo Agenda.
- **Sem audit log / LGPD** — risco real nas verticais que tocam dado de saúde (clínicas, vet, psicologia).
- **pt-BR colado no código** (rules, summary, prompt do provider) — não bloqueia clientes brasileiros, mas fecha a porta pra outros idiomas sem refactor.

Nenhum desses impede começar por **contabilidade → assistência técnica → condomínio**, que é justamente por isso a sequência recomendada: são os ramos onde o que já existe entrega valor real, e os débitos acima podem ser resolvidos em paralelo, sem bloquear a venda.
