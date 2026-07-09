import type { AttendantInput, AttendantOutput, AttendantProvider } from '../types'
import { buildPrompt, parseClaudeJson } from './claude-cli.server'

// Segunda versão do motor: chama a API da Anthropic direto (o cliente paga os
// tokens via ANTHROPIC_API_KEY). A outra versão (claude_cli) usa a assinatura
// pessoal logada na máquina. As DUAS montam o MESMO prompt (buildPrompt) e usam
// o MESMO parser (parseClaudeJson) — só muda o transporte, então a saída é
// comparável no banco de provas (`npm run eval:motor`).

const API_URL = 'https://api.anthropic.com/v1/messages'
// Modelo configurável por env. Default no Opus 4.8 (mais capaz); o dono baixa
// para sonnet/haiku por economia de tokens de cada tenant direto no .env.
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'
const TIMEOUT_MS = Number(process.env.ATTENDANT_TIMEOUT_MS ?? 30000)
// A saída (JSON com PII do cliente) só aparece no log atrás desta flag.
const DEBUG = process.env.ATTENDANT_DEBUG === '1'
// O reply cabe folgado — é uma mensagem de WhatsApp + a estrutura do JSON.
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 1024)

type AnthropicTextBlock = { type: string; text?: string }
type AnthropicResponse = {
  content?: AnthropicTextBlock[]
  stop_reason?: string
  stop_details?: { category?: string | null } | null
}

/**
 * Uma chamada à API de mensagens da Anthropic. Sem `thinking` (Opus 4.8 roda sem
 * quando omitido → menos latência, o gargalo nº1 do motor) e sem ferramentas —
 * é geração de texto pura, o prompt exige só o JSON. Lança em qualquer falha; o
 * dispatcher transforma isso em fallback seguro que escala para humano.
 */
async function callAnthropic(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY ausente no ambiente')
  }

  // Timeout próprio (mesmo teto do claude_cli). fetch global do Node — sem SDK,
  // sem dependência nova (regra do projeto: não adicionar libs sem perguntar).
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`anthropic API ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as AnthropicResponse
  // Classificadores de segurança podem recusar (HTTP 200 + stop_reason=refusal):
  // checa ANTES de ler o content, senão pega texto vazio e cai num JSON inválido.
  if (data.stop_reason === 'refusal') {
    throw new Error(`anthropic recusou (${data.stop_details?.category ?? 'sem categoria'})`)
  }
  return (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
}

/**
 * Provider de IA real via API da Anthropic. A saída é validada pelo dispatcher;
 * qualquer falha vira fallback seguro lá.
 */
export const anthropicApiProvider: AttendantProvider = {
  name: 'anthropic_api',
  async generate(input: AttendantInput): Promise<AttendantOutput> {
    const start = Date.now()
    let text: string
    try {
      text = await callAnthropic(buildPrompt(input))
    } catch (error) {
      console.error(
        `[anthropic_api] erro em ${Date.now() - start}ms:`,
        error instanceof Error ? error.message : error,
      )
      throw error
    }
    try {
      const output = parseClaudeJson(text) as AttendantOutput
      console.log(`[anthropic_api] ok em ${Date.now() - start}ms`)
      return output
    } catch (error) {
      console.error(
        `[anthropic_api] JSON inválido em ${Date.now() - start}ms (saída de ${text.length} chars)${
          DEBUG ? `. Saída crua: ${text.slice(0, 400)}` : ''
        }`,
      )
      throw error
    }
  },
}
