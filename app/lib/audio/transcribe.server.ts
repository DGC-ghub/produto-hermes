import { spawn } from 'node:child_process'

// Transcrição local de áudio (faster-whisper) via processo Python isolado — mesmo
// padrão de "borda" do claude-cli: o Node só invoca e lê JSON. Mantém o atendente
// pessoal (~/.hermes) fora do caminho; este motor é só do produto.
const PYTHON = process.env.TRANSCRIBE_PYTHON ?? '.venv-transcribe/bin/python'
const SCRIPT = process.env.TRANSCRIBE_SCRIPT ?? 'scripts/transcribe.py'
const MODEL = process.env.WHISPER_MODEL ?? 'base'
// Timeout generoso: no Pi o load do modelo + decodificação de um áudio curto
// fica em ~15s; áudios maiores podem passar disso.
const TIMEOUT_MS = Number(process.env.TRANSCRIBE_TIMEOUT_MS ?? 120000)

// O texto transcrito É conteúdo do cliente (PII). Por padrão NÃO o logamos — só
// metadados (tamanho/idioma/tempo). O conteúdo fica atrás de ATTENDANT_DEBUG=1.
const DEBUG = process.env.ATTENDANT_DEBUG === '1'

const MAX_TRANSCRIPT_LENGTH = 4000

// Extensões de áudio aceitas. Nota de WhatsApp costuma vir como .ogg (codec opus).
const SUPPORTED_AUDIO_EXTENSIONS = [
  '.ogg',
  '.oga',
  '.opus',
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
  '.webm',
  '.flac',
]

// Mapeia o mime do upload/gravação para uma extensão. Gravação do navegador
// (MediaRecorder) costuma vir como audio/webm ou audio/ogg (codec opus).
const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
}

export type Transcription = {
  text: string
  language: string
  duration: number
  model: string
}

/**
 * Diz se o nome de arquivo tem extensão de áudio suportada. Função pura —
 * usada para barrar uploads inválidos antes de gastar transcrição.
 */
export function isSupportedAudioExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return SUPPORTED_AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * Escolhe a extensão para gravar o áudio recebido: prioriza a extensão do nome
 * do arquivo; senão deduz pelo mime (ignorando o sufixo de codec). Devolve null
 * quando o formato não é suportado. Função pura.
 */
export function audioExtensionFor(fileName: string, mimeType: string): string | null {
  const lower = fileName.toLowerCase()
  const fromName = SUPPORTED_AUDIO_EXTENSIONS.find((ext) => lower.endsWith(ext))
  if (fromName) {
    return fromName
  }
  const baseMime = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  return MIME_TO_EXT[baseMime] ?? null
}

/**
 * Normaliza o texto transcrito: junta quebras de linha, colapsa espaços e
 * trunca em um teto defensivo. Função pura.
 */
export function cleanTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TRANSCRIPT_LENGTH)
}

/**
 * Extrai e valida o JSON impresso pelo scripts/transcribe.py. Tolera lixo ao
 * redor (warnings que vazem pro stdout) pegando do primeiro `{` ao último `}`.
 * Lança se não houver JSON reconhecível ou se `text` não for string. Função pura.
 */
export function parseTranscriptionOutput(stdout: string): Transcription {
  const body = stdout.trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('saída da transcrição sem JSON reconhecível')
  }
  const parsed = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>
  if (typeof parsed.text !== 'string') {
    throw new Error('saída da transcrição sem campo "text"')
  }
  return {
    text: cleanTranscript(parsed.text),
    language: typeof parsed.language === 'string' ? parsed.language : 'unknown',
    duration: typeof parsed.duration === 'number' ? parsed.duration : 0,
    model: typeof parsed.model === 'string' ? parsed.model : MODEL,
  }
}

function runTranscriber(audioPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [SCRIPT, audioPath], {
      cwd: process.cwd(),
      timeout: TIMEOUT_MS,
      env: { ...process.env, WHISPER_MODEL: MODEL },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`transcritor saiu com código ${code}: ${stderr.slice(0, 200)}`))
      }
    })
  })
}

/**
 * Transcreve um arquivo de áudio para texto (PT por padrão) usando faster-whisper.
 * Lança em qualquer falha — o chamador decide o fallback (ex.: pedir para o cliente
 * digitar). O texto transcrito nunca é logado por padrão (PII).
 */
export async function transcribeAudio(audioPath: string): Promise<Transcription> {
  const start = Date.now()
  let stdout: string
  try {
    stdout = await runTranscriber(audioPath)
  } catch (error) {
    console.error(
      `[transcribe] erro em ${Date.now() - start}ms:`,
      error instanceof Error ? error.message : error,
    )
    throw error
  }
  try {
    const result = parseTranscriptionOutput(stdout)
    console.log(
      `[transcribe] ok em ${Date.now() - start}ms (${result.language}, ${result.duration}s de áudio, ${result.text.length} chars${DEBUG ? `: "${result.text}"` : ''})`,
    )
    return result
  } catch (error) {
    console.error(
      `[transcribe] saída inválida em ${Date.now() - start}ms${DEBUG ? `. Saída crua: ${stdout.slice(0, 400)}` : ''}`,
    )
    throw error
  }
}
