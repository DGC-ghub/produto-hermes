import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { audioExtensionFor, transcribeAudio } from './transcribe.server'

// Teto de tamanho do áudio recebido (nota de voz curta é leve; isto é defesa).
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES ?? 15_000_000)

/**
 * Recebe um arquivo de áudio (upload ou gravação), grava num temporário isolado,
 * transcreve e devolve o texto. Sempre apaga o temporário. Lança em formato não
 * suportado, áudio vazio ou grande demais — o chamador decide o fallback.
 */
export async function transcribeUploadedAudio(file: File): Promise<string> {
  if (file.size === 0) {
    throw new Error('áudio vazio')
  }
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error(`áudio grande demais (${file.size} bytes, máx ${MAX_AUDIO_BYTES})`)
  }
  const ext = audioExtensionFor(file.name ?? '', file.type ?? '')
  if (!ext) {
    throw new Error(`formato de áudio não suportado: ${file.type || file.name || 'desconhecido'}`)
  }

  const dir = await mkdtemp(join(tmpdir(), 'hermes-audio-'))
  const filePath = join(dir, `audio${ext}`)
  try {
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()))
    const result = await transcribeAudio(filePath)
    return result.text
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
