# Regra de Negócio — Faturamento CSMed (como funciona hoje)

> Etapa 1 · rascunho — extraído do áudio (2026-07-03). Nomes e valores a confirmar com ela.

## O que a CSMed faz
Gerencia e cobra o trabalho de médicos em hospitais/clínicas: controla quem trabalhou e quanto, **fatura o cliente** (hospital) e faz o **repasse aos médicos**.

## As 3 formas de cobrança
1. **Por plantão** — turno de 12h ou 6h. ~**90% dos contratos**.
2. **Por hora.**
3. **Por procedimento** — por cirurgia realizada.
- **+ Coordenador médico:** valor **fixo mensal** à parte. Não tem escala; dá suporte técnico e organiza os protocolos da equipe; recebe tenha sido acionado ou não.

## Fluxo atual (na mão)
1. **escalaApp** — app onde a **Miria** cadastra os médicos, dá acesso e monta a escala. Cada médico tem uma regra combinada (ex.: 24h a cada 15 dias) que se repete todo mês.
2. Exporta a escala pra **Excel**.
3. Monta o **mapa de horas** — tabela visual: qual médico fez quantos plantões/horas no mês.
4. Monta o **relatório gerencial** — o que o contrato prevê × valor × quantidade → valor a faturar do cliente. Soma o coordenador.
5. (Procedimento) cadastra **cada cirurgia na mão** a partir da foto que o médico manda.

## Exemplo real (anestesistas — Itaituba)
- Mês de 31 dias: **170 plantões de 12h** (138 de seg–sex + 32 de fim de semana).
- Valor do plantão: **R$ 3.414,17**.
- Contrato ≈ **R$ 580 mil** + **R$ 14.000** do coordenador.
- Vários médicos por dia (ex.: quem faz 24h aparece como 2 plantões de 12h no mapa; base = 12h).

## Por procedimento (ex.: contrato no CREAR)
- Médico opera → tira **foto da tela do sistema do hospital** → manda no grupo.
- CSMed cadastra cada cirurgia: **código do procedimento**, **vias de acesso** (quantas vezes precisou abrir), **porte cirúrgico** (nível, ex.: "8C").
- Contrato define o valor por porte (ex.: **8C = R$ 818**).
- **Médico recebe 70%** do que a CSMed recebe. Não depende da escala.

## Particularidades
- **Período de fechamento** varia: tem cliente que conta do **dia 26 ao 26** (não 1–31).
- Meses de 28/30 dias → menos plantões possíveis.
- Se for **por hora**: a Miria lança 6h/12h no escalaApp; mapa e relatório convertem pra hora.

## Pessoas
- **Miria** — escalaApp: cadastro dos médicos, acessos e regras de escala.
- **Eder / Edgar** — montou os relatórios em Excel (mapa de horas, relatório gerencial).

## A maior dor
**Conciliação.** Não há sistema único que junte plantão + mensal + procedimento; é tudo Excel manual. A parte de procedimento não dá pra automatizar hoje porque a CSMed **não tem acesso ao sistema do hospital** — depende da foto do médico, redigitada à mão.
