// Quais AÇÕES a IA de um cliente pode executar. Decisão do servidor, um lugar só.
//
// A §6.7 manda o servidor construir o conjunto de `tools` e seus `limits`. O motivo é
// concreto: `tools` é o que transforma "a IA respondeu" em "a IA fez" — abriu chamado,
// pediu agendamento. Se a candidata gerada a partir do questionário pudesse decidir isso,
// texto colado no questionário por um cliente (ou por quem mandou o texto para ele)
// escolheria o que a IA executa e com quais limites.
//
// Por isso a política vive AQUI, em código, e é aplicada por substituição — nunca por
// mesclagem com o que a IA propôs. Mesclar seria dar à IA a palavra final sobre o campo
// mais perigoso da config: bastaria ela mandar `requireConfirmation: false`.
import type { ToolConfig } from '../attendant/tenant-config'

/**
 * O conjunto de ferramentas que uma IA recém-preparada recebe.
 *
 * **Nenhuma.** É decisão de produto do dono para o primeiro piloto: a IA responde, usa a
 * base de conhecimento, respeita os guard-rails e chama uma pessoa quando não sabe ou o
 * caso é sensível — mas não executa ação operacional.
 *
 * O ganho não é técnico, é de risco: uma IA que só responde errado incomoda; uma IA que
 * age errado cria chamado falso, agenda o que a empresa não atende e some com o problema
 * dentro do banco do cliente. Enquanto não houver um cliente real pedindo, o custo de
 * ligar é maior que o benefício.
 *
 * **Como habilitar depois:** uma ferramenta por vez, quando um cliente precisar, e cada
 * uma entra com os quatro itens juntos — `limits` decididos aqui (confirmação obrigatória
 * e campos exigidos), teste no simulador, auditoria do que foi executado e aprovação
 * explícita do cliente. Habilitar sem os quatro é o que este arquivo existe para evitar.
 *
 * Sem parâmetros de propósito: uma matriz "qual segmento recebe qual ferramenta" seria
 * uma generalização inventada antes do primeiro caso real. Quando existir o caso, ele
 * dirá qual é o eixo — e ele entra como argumento aqui.
 */
export function politicaDeFerramentas(): ToolConfig[] {
  // Array novo a cada chamada: uma constante compartilhada deixaria um chamador que
  // empurrasse um item contaminar toda config montada depois, no mesmo processo.
  return []
}
