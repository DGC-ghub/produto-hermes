# Roteiro — Reunião CSMed (1ª quinzena de agosto)

> Rascunho (2026-07-04). UMA reunião, DOIS assuntos com a mesma pessoa: **A)** faturamento
> (a dor dela) → vender o **diagnóstico pago**; **B)** Hermes → oferecer o **piloto grátis**.
> A ordem importa: a dor dela primeiro; o Hermes é brinde no fim — a família não é funil.

## Antes de entrar (checklist)
- [ ] Reler `regra-de-negocio.md`; levar o `fluxo.svg` aberto (é o "eu entendi" visual).
- [ ] **Definir preço e duração do diagnóstico** (não cravar na hora — ver Em aberto).
- [ ] Conferir a lista de nomes/valores incertos do `README.md` — não usar nenhum com ela
      antes de ela confirmar.
- [ ] Simulador do Hermes pronto no tenant csmed (parte B) — mas só abrir se houver clima.

---

## Parte A1 — Abertura: devolver o entendimento (~10 min)
Frase de entrada: *"Ouvi seu áudio com calma. Deixa eu te contar o que eu entendi do seu
fechamento — e você me corrige onde eu errar."*

Resumo a devolver (5 frases, sem jargão):
- Vocês cobram de três jeitos: plantão (a maioria), hora e procedimento — e ainda tem o
  coordenador, que é fixo por mês, com ou sem acionamento.
- A Miria monta a escala no escalaApp com a regra de cada médico; isso vira um Excel.
- Do Excel, o Eder/Edgar monta na mão o mapa de horas e o relatório gerencial que vira a fatura.
- No procedimento, o médico manda a foto da tela do sistema do hospital e vocês redigitam
  cirurgia por cirurgia — porque ele não vai preencher dois sistemas e vocês não têm acesso
  ao do hospital.
- E ainda tem cliente que fecha de 26 a 26, mês de 28/30 dias… é essa **conciliação** toda,
  na mão, que come dias do mês.

Fechar com: *"O que eu entendi errado? O que faltou?"* — deixar ELA corrigir (validação +
confiança). Anotar as correções na hora.

> Nota: os nomes incertos da transcrição (Miria, Eder/Edgar, Itaituba, CREAR) entram AQUI de
> propósito, com leveza — devolver o entendimento é exatamente onde ela os corrige. Não usar
> nenhum valor em R$ como afirmação antes de ela confirmar.

## Parte A2 — Levantamento (perguntas NA ORDEM)
Começa pelo fácil (volume aquece), depois dor, depois sistemas/acessos, decisão por último.

**Volume**
1. Quantos contratos ativos hoje? Com quantos clientes (hospitais/clínicas)?
2. Quantos médicos no total passam pela folha de vocês num mês?
3. Dos contratos, quantos são plantão / hora / procedimento? (no áudio: ~90% plantão — confirmar)
4. Quantos procedimentos/mês chegam por foto (nos contratos tipo CREAR)?

**Dor em número**
5. O fechamento de UM contrato grande (tipo o de Itaituba) leva quanto tempo? E o mês inteiro?
6. Quem trabalha no fechamento além de você, da Miria e do Eder/Edgar?
7. Onde mais erra ou retrabalha? Já teve erro que custou dinheiro ou desgaste com cliente?
8. No procedimento: quanto tempo por cirurgia (receber foto → conferir → digitar)?
9. **Repasse dos médicos:** no procedimento é 70% — e no plantão/hora, como é o acerto com
   o médico? Quem calcula isso hoje? *(lacuna real: o áudio só cobre o 70% do procedimento)*

**Sistemas e acessos**
10. O escalaApp exporta exatamente o quê? (mostrar interesse no arquivo: colunas fixas? um
    export por escala?) Ele tem API/integração ou só o Excel?
11. As planilhas do Eder/Edgar: uma por contrato? Seguem um padrão ou cada uma é de um jeito?
12. O sistema do hospital: alguém já PEDIU acesso ou um export pra eles? Tem hospital que
    toparia? (é relacionamento, não técnica — se um topar, elimina a redigitação lá)

**Decisão e urgência**
13. Se o fechamento virasse "conferir e apertar um botão", o que muda pra CSMed? Dá pra
    pegar mais contrato sem contratar mais gente?
14. Tem uma verba pensada pra resolver isso? E prazo — tem alguma pressão (cliente novo,
    auditoria, cansaço mesmo)?
15. A decisão de investir é sua sozinha, ou tem mais alguém na conversa (sócio, contador,
    o financeiro)? *(o briefing assume que é ela — confirmar)*

## Parte A3 — Fecho: emendar o diagnóstico pago
Ponte (depois dos números): *"Dá pra resolver — e começa pelo plantão, que é 90% do problema.
Mas eu me recuso a te dar preço de sistema no chute: chutar alto te assusta, chutar baixo
quebra a gente no meio. O passo certo é um diagnóstico."*

**O que o diagnóstico entrega** (2–3 semanas mergulhado nos dados reais):
- Mapa de todos os contratos: modelo, valores, regras e particularidades de cada um.
- Análise dos exports reais do escalaApp + planilhas do Eder/Edgar (dá pra importar direto?).
- Desenho da solução por fase, com o que automatiza já e o que depende do hospital (limite
  honesto do procedimento).
- **Orçamento fechado do sistema, por fase** — preço de verdade, não chute.

**Por que pago:** compromisso dos dois lados; ela recebe um documento que vale sozinho
(mesmo que não feche o sistema, sai com o negócio mapeado). Se fechar a fase 2, o valor do
diagnóstico [vira crédito / abate — decidir antes, ver Em aberto].

**Próximo passo concreto (sair combinado):** ela envia o export do escalaApp + as planilhas
de 2 meses fechados (ex.: o exemplo de Itaituba) + 1 exemplo de fatura de procedimento →
data de início do diagnóstico.

## Parte B — Hermes: o piloto grátis (no FIM, ~10 min, tom leve)
Gancho: *"Antes de ir — deixa eu te mostrar uma coisa que eu construí e que tem tudo a ver
com o WhatsApp de vocês."*
- Demo curta no simulador (tenant csmed já existe): 1 pergunta de FAQ + 1 demanda de plantão
  virando chamado registrado.
- Oferta: **piloto grátis com prazo fechado** (ex.: 60 dias — combinar na hora) num número
  de WhatsApp — a IA atende, escala pra humano quando precisa (urgência médica manda ligar
  192 na hora), e ela acompanha tudo numa central. Sem compromisso; no fim do prazo ela
  decide se quis.
- Combinar critério de sucesso simples (ex.: "nenhuma mensagem sem resposta e você gastando
  menos tempo no WhatsApp").
- **Se houver cansaço ou pressa: plantar a semente e marcar outra hora. Não forçar.**
- Não misturar os assuntos: o diagnóstico é pago, o piloto é grátis — deixar isso explícito.

## Checklist de saída (a reunião valeu se…)
- [ ] Entendimento validado/corrigido por ela (A1)
- [ ] Números 1–8 anotados + resposta do repasse (9) + quem decide (15)
- [ ] Export do escalaApp: formato entendido (10–11)
- [ ] Situação de acesso ao hospital (12)
- [ ] Diagnóstico aceito em princípio + material que ela vai mandar + data
- [ ] Piloto Hermes: sim / depois / não

## Em aberto / a confirmar
- **Preço e duração do diagnóstico** — decidir ANTES da reunião (Gabriel). Não cravar na hora
  se não estiver definido.
- Se o valor do diagnóstico vira crédito na fase 2 (decisão comercial do Gabriel).
- Nomes/valores da transcrição (lista no `README.md`) — confirmar com ela na A1.
- Repasse de plantão/hora (pergunta 9) — o áudio não cobre.
- Formato da reunião (presencial/vídeo) e se o Danilo participa.
- Se a parte B entra mesmo nesta reunião ou fica pra uma segunda conversa (ler o clima).
