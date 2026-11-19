// Opt-in do paciente (DGC-348). Tudo aqui é PURO: a decisão de quem pode receber o quê mora
// no balcão (código), nunca no prompt. A política da Meta pede opt-in para mensagem que a
// empresa inicia; bloqueio e denúncia derrubam a qualidade do número da clínica.

export type StatusOptIn = 'sim' | 'nao'
export type ContatoOptIn = { status: StatusOptIn | string | null }
export type RegistroOptIn = {
  status: StatusOptIn | string | null
  askedAt: Date | null
  decidedAt?: Date | null
}

export type TipoMensagem = 'lembrete_consulta' | 'reativacao' | 'followup_marketing'

export const OPT_IN_QUESTION =
  'Quer receber lembretes e novidades da clínica por aqui? Responda SIM ou NÃO.'
export const OPT_IN_ACK_SIM =
  'Combinado! Vou te mandar lembretes e novidades da clínica por aqui. Para parar, é só escrever PARAR.'
export const OPT_IN_ACK_NAO =
  'Tudo bem, não vou mandar lembretes nem novidades. Se mudar de ideia, é só avisar.'
export const OPT_IN_ACK_PARAR =
  'Pronto, não vou mais te mandar lembretes nem novidades. Se precisar da clínica, é só escrever aqui.'

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// "parar"/"sair" só valem como mensagem curta e inteira: "vou sair mais cedo" não é pedido.
const PARAR = new Set([
  'parar',
  'pare',
  'sair',
  'stop',
  'parar de receber',
  'quero parar',
  'quero parar de receber',
  'sair da lista',
  'nao quero receber mais',
  'nao quero mais receber',
  'nao me mande mais',
  'nao envie mais',
])
const SIM = new Set(['sim', 's', 'quero', 'pode', 'claro', 'aceito', 'ok', 'beleza', 'com certeza'])
const NAO = new Set(['nao', 'n', 'nao quero', 'dispenso', 'nunca', 'nem'])
const MAX_PALAVRAS_RESPOSTA = 6

/**
 * Entende a resposta do paciente em linguagem natural. `parar` vale a qualquer momento;
 * `sim`/`nao` só devem ser aplicados quando a pergunta está pendente (quem chama confere).
 * Resposta longa, com pergunta, ou que mistura sim e não = `null` (segue a conversa normal).
 */
export function interpretarRespostaOptIn(text: string): 'sim' | 'nao' | 'parar' | null {
  const t = norm(text)
  if (!t) return null
  if (PARAR.has(t)) return 'parar'
  const palavras = t.split(' ')
  if (palavras.length > MAX_PALAVRAS_RESPOSTA || text.includes('?')) return null
  const temNao = palavras.some(
    (p) => p === 'nao' || p === 'nunca' || p === 'dispenso' || p === 'nem',
  )
  const temSim = palavras.some((p) => SIM.has(p)) || SIM.has(t)
  // "não quero" é não; "sim, mas não agora" mistura os dois e vai para a conversa normal.
  const simExplicito = palavras.some(
    (p) => p === 'sim' || p === 's' || p === 'claro' || p === 'aceito',
  )
  if (temNao && simExplicito) return null
  if (temNao || NAO.has(t)) return 'nao'
  if (temSim || t.startsWith('com certeza')) return 'sim'
  return null
}

/**
 * Quem pode receber qual tipo de mensagem.
 * - `lembrete_consulta`: consulta marcada pelo PRÓPRIO paciente — sempre pode (é serviço que
 *   ele pediu). Se a consulta não foi marcada por ele, essa exceção não vale.
 * - `reativacao` e `followup_marketing`: só com opt-in `sim`.
 */
export function podeReceber(
  contato: ContatoOptIn | null | undefined,
  tipo: TipoMensagem,
  opcoes: { consultaMarcadaPeloPaciente?: boolean } = {},
): boolean {
  if (tipo === 'lembrete_consulta') return opcoes.consultaMarcadaPeloPaciente !== false
  return contato?.status === 'sim'
}

export type Lote<T> = { dia: string; itens: T[] }

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/

function somarDias(dia: string, n: number): string {
  const m = DIA.exec(dia)
  if (!m) throw new Error('inicio deve ser AAAA-MM-DD')
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n))
  return d.toISOString().slice(0, 10)
}

/**
 * Espalha uma lista de envios em lotes por dia, sem passar de `limiteDiario` (configurável
 * por tenant). `jaEnviadosNoPrimeiroDia` desconta o que já saiu no dia de início.
 */
export function distribuirEmLotes<T>(
  itens: readonly T[],
  opcoes: { limiteDiario: number; inicio: string; jaEnviadosNoPrimeiroDia?: number },
): Lote<T>[] {
  const { limiteDiario, inicio } = opcoes
  if (!Number.isInteger(limiteDiario) || limiteDiario < 1) {
    throw new Error('limiteDiario deve ser um inteiro maior que zero')
  }
  somarDias(inicio, 0) // valida o formato
  const lotes: Lote<T>[] = []
  let dia = 0
  let capacidade = Math.max(0, limiteDiario - Math.max(0, opcoes.jaEnviadosNoPrimeiroDia ?? 0))
  let i = 0
  while (i < itens.length) {
    if (capacidade === 0) {
      dia += 1
      capacidade = limiteDiario
      continue
    }
    const fatia = itens.slice(i, i + capacidade)
    lotes.push({ dia: somarDias(inicio, dia), itens: [...fatia] })
    i += fatia.length
    dia += 1
    capacidade = limiteDiario
  }
  return lotes
}

/** Pergunta uma vez só, só depois de resolver o pedido, nunca em transbordo. */
export function deveFazerPerguntaOptIn(input: {
  habilitado: boolean
  registro: RegistroOptIn | null
  pedidoResolvido: boolean
  precisaHumano: boolean
}): boolean {
  if (!input.habilitado || input.precisaHumano || !input.pedidoResolvido) return false
  return !input.registro?.askedAt && !input.registro?.status
}

export function foiPerguntaOptIn(ultimaFalaDaAssistente: string | undefined): boolean {
  return !!ultimaFalaDaAssistente?.includes(OPT_IN_QUESTION)
}

const AGRADECIMENTO =
  /^(muito )?(obrigad[oa]|valeu|era so isso|so isso|tudo certo|ok obrigad[oa])( .*)?$/

/** O paciente deu o assunto por encerrado ("obrigada", "era só isso"). */
export function pacienteEncerrouPedido(text: string): boolean {
  return AGRADECIMENTO.test(norm(text)) && text.length <= 40
}

/** Texto do selo no painel da conversa; `null` = nunca perguntado (sem selo). */
export function seloOptIn(
  registro: { status: string | null; decidedAt: Date | null } | null,
): string | null {
  if (!registro) return null
  if (registro.status !== 'sim' && registro.status !== 'nao') {
    return 'Ainda não respondeu sobre lembretes'
  }
  const d = new Date((registro.decidedAt ?? new Date()).getTime() - 3 * 3600_000)
  const dia = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  return registro.status === 'sim' ? `Aceitou lembretes em ${dia}` : `Recusou lembretes em ${dia}`
}
