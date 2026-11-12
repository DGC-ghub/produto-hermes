# Hermes — mapa de cobertura e relatório de testes (2026-11-12)

Tarefa DGC-87. Dados fictícios; provider de IA simulado; sem WhatsApp real.

## 1. Resultado da suíte (`npx vitest run`)
- Cópia isolada, com a suíte nova: **122 arquivos, 1519 testes, todos verdes** (~3 min).
- Problema do `.test-template.db`: na pasta antiga `/home/dgc/projects/produto-hermes`, o `vitest.global-setup.ts` apagava o
  molde no diretório do projeto, e duas rodadas ao mesmo tempo se derrubavam ("Molde de teste ausente"). Foi observado
  em rodadas paralelas nessa pasta; não guardei a saída, então **não cito número de falhas**. Já foi corrigido no
  commit `c2c05b6` (mkdtemp por rodada) e só acontecia na pasta antiga. Não é bug de produto. Contorno usado na época:
  cópia privada.
- Atenção: a cópia em `/tmp` falha 3 testes (`setup/banco.server.test.ts` x2, `setup-processar.subprocesso.test.ts`) porque
  eles checam "banco fora do /tmp não é descartável"; rodar fora de `/tmp`.

## 2. O que tem teste
Cobertura por arquivo-fonte (teste com o mesmo nome ou que importa o módulo): quase toda a lógica de `app/lib`: motor de
conversa (guard, corrida, retry, modo, ordem, métricas, billing, telemetria), agenda (slots, pedido, confirmação, registro,
memória, clínica demo), handoff, leads, tickets, tenants/config, setup assistido, billing/Mercado Pago (lib), auth, e-mail,
Baileys (canal), rotas `atendente`, `demo.chat`, `configuracoes`, `canais`, `metrics`, `health`, `preparar-ia`, `testar-ia`.

## 3. O que NÃO tem teste (por risco)
| Risco | Item | Observação |
|---|---|---|
| **Alto** | `routes/webhook.whatsapp.tsx` | Entrada de TODA mensagem real do cliente (verificação, assinatura, resolução do tenant pelo número, fila). Só testado indiretamente (`whatsapp-queue`, `whatsapp-envio`). Falta: assinatura inválida, tenant desconhecido, mensagem duplicada, mensagem de um número nunca vaza para outro tenant. |
| **Alto** | `routes/webhook.mercadopago.tsx` | Cobrança/assinatura. Falta teste de assinatura inválida e idempotência. |
| Médio | `routes/redefinir-senha`, `verificar-email`, `logout`, `assinar` | Fluxos de conta sem teste de rota (a lib por trás tem teste). |
| Médio | `lib/eval/runner.server.ts`, `scenarios.ts`, `scripts/eval-gate.ts` | O gate de qualidade da IA não é testado em si. |
| Baixo | Componentes de UI (`components/ui/*`), `audio-recorder`, `OnboardingChecklist` | Visual. |
| Baixo | `scripts/*` (provas, seeds, `tenant-add`, `operator-add`) | Operacionais; `tenant-add` merece teste (cria empresa). |

## 4. Fluxos críticos: situação
| Fluxo | Teste |
|---|---|
| Contato → dúvida → agendar → confirmar (1) | **novo** `agenda/demo-clinica.e2e.test.ts` |
| Tema de saúde → recepção, sem IA, sem agendar | existia (unidade) + **novo** (ponta a ponta) |
| Recepção assume → IA se cala | **novo** |
| Horário fora do expediente / ocupado | **novo** / existia |
| Isolamento: paciente A não confirma consulta de B; mesmo contato em 2 empresas = 2 conversas; agenda de uma empresa não aparece na outra | **novo** |
| Demo pública nunca grava na agenda | existia + **novo** |
| Webhook WhatsApp real (assinatura, duplicata, tenant) | **SEM TESTE** (ver tabela) |
| Cancelar/remarcar pelo WhatsApp | não coberto no e2e (existe `operation` no pedido; unidade em `pedido.test.ts`) |

## 5. Bugs
Nenhum bug de produto encontrado nesta rodada. Observação de comportamento (não é bug, está por desenho): em `needs_human`
(fila) a IA ainda responde; só se cala quando a recepção assume (`human`). Vale o Gabriel confirmar que é o esperado para
saúde: o paciente com "dor de dente" fica `needs_human` e recebe a mensagem de transbordo, mas uma segunda mensagem dele
antes de a recepção assumir ainda passa pelo balcão/IA.
