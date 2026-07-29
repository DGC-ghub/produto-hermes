# Banco de provas do motor — harness de avaliação

Como a gente sabe que uma mudança no prompt, na base de conhecimento ou no
modelo **melhorou** o atendimento em vez de piorar.

Testes normais (`npm test`) provam que o código não quebrou. Eles não dizem nada
sobre a qualidade da resposta que o cliente recebe — essa é gerada por um modelo
não-determinístico e não cabe num `expect(x).toBe(y)`. Este harness cobre isso.

## Dois modos

| Comando | Para quê | Execuções | Falha significa |
|---|---|---|---|
| `npm run eval:motor` | **Ver** a IA respondendo; leitura humana | 1 por cenário | "olha isso aqui" |
| `npm run eval:gate` | **Medir** regressão contra o baseline | N por cenário (default 3) | "não pode entrar assim" |

Os dois usam os mesmos cenários (`app/lib/eval/scenarios.ts`) e as mesmas
verificações (`app/lib/eval/checks.ts`) — nunca divergem sobre o que é correto.

## Por que N execuções

LLM não é determinístico. Uma rodada por cenário mede **sorte**, não qualidade.
O harness roda cada cenário N vezes e guarda a **taxa de aprovação** de cada
verificação: "passa 9 de 10" é informação, "passou" não é.

É também o que impede o gate de virar teste flaky. Um teste que falha
aleatoriamente 1 vez em 10 treina o time a ignorar o vermelho — e aí o gate não
serve mais para nada.

## Verificações críticas

Nem toda verificação vale o mesmo:

- 🔒 **Crítica** — guard-rail de segurança. Zero tolerância: qualquer queda entre
  rodadas reprova. São `escala: true` (pedido de humano, tema sensível) e todo
  `naoContem`/`naoContemRegex` (não vazar prompt, não prometer o impossível, não
  cravar preço, não orientar dose de remédio).
- **Normal** — qualidade de produto (`escala: false`, `abreChamado`). Tolera
  ruído estatístico até o limiar.

Cenário sem expectativa declarada é revisão humana pura: pontua 1, não pune nem
premia. Serve para você LER a resposta.

## O baseline

`eval/baseline.json` é versionado no repositório. É ele que transforma "achei que
ficou melhor" em "a nota subiu de 82% para 89% e nenhum cenário regrediu".

```bash
npm run eval:gate           # compara com o baseline, sai != 0 se regrediu
npm run eval:baseline       # promove a rodada atual a novo baseline
```

Mexeu no prompt? Rode o gate. Se a nota subiu, promova o baseline **no mesmo
commit da mudança** — o diff do JSON mostra exatamente o que a alteração fez com
a qualidade.

### Como o gate compara

- **Maçã com maçã.** Só entram na conta as verificações presentes nos dois lados.
  Adicionar uma verificação nova que ainda falha não é lido como "quebrou" —
  você subiu a régua, e ela passa a valer da próxima promoção em diante.
- **Cenário novo nunca reprova.** Não havia com o que comparar.
- **Cenário que sumiu é reportado, não reprova.** Pode ter sido removido de propósito.
- **Fallback alto reprova a rodada inteira.** Quando o cérebro cai na resposta
  genérica, verificações do tipo "não pode conter X" passam de graça e **inflam**
  a nota. Uma rodada assim não é medição, é ruído — e o gate diz isso em vez de
  mostrar um 100% mentiroso.

Tolerâncias padrão (`app/lib/eval/baseline.ts`): 5 pontos no score global, 15 por
cenário, 20 por verificação normal, 0 nas críticas.

## Custo e tempo

Cada execução chama o modelo de verdade e leva ~20s no Pi. 26 cenários × 3
execuções ≈ 26 minutos sequencial; a concorrência padrão (2) casa com o semáforo
do provider e derruba isso pela metade.

```bash
npm run eval:gate -- --runs 1 --tenant csmed    # iteração rápida
npm run eval:gate -- --runs 5                   # medição séria, menos ruído
```

## Pré-requisito: o provider

O gate testa o cérebro **real**. Precisa de um dos dois:

- `ATTENDANT_PROVIDER=claude_cli` — usa a assinatura pessoal (`claude` logado na
  máquina). Custo zero. **Se o CLI deslogar, tudo cai em fallback** — o gate
  detecta e reprova a rodada em vez de gravar uma nota falsa.
- `ATTENDANT_PROVIDER=anthropic_api` + `ANTHROPIC_API_KEY` — paga por token,
  funciona em runner hospedado.

Nunca rode o gate com o provider `mock`: ele passa em tudo e gravaria um baseline
de 100% sem sentido.

## No CI

`.github/workflows/eval.yml` — **desligado no automático de propósito**, porque
cada rodada custa (dinheiro ou tempo de máquina). Só roda por
`workflow_dispatch`. O topo do arquivo documenta as duas formas de ligar (runner
self-hosted no Pi, ou API com secret) e como habilitar por PR/agendamento.

Recomendação: só ligue por PR depois que o baseline estiver estável. Um gate
barulhento é pior que gate nenhum — ensina o time a ignorar o vermelho.
