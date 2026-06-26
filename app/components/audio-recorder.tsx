import { useEffect, useRef, useState } from 'react'
import { useSubmit } from 'react-router'

type Props = {
  tenantSlug: string
  conversationId: string | null
  disabled: boolean
  // Avisa o pai para ligar o indicador "processando áudio" (UI otimista).
  onSend: () => void
}

type RecState = 'idle' | 'recording' | 'recorded'

/**
 * Gravador de áudio no navegador (MediaRecorder). Grava → para → preview → envia
 * o blob como upload multipart para a action do /demo/chat (mesmo endpoint do
 * upload de arquivo). É client-only: usa detecção de suporte pós-montagem para
 * não quebrar a hidratação no SSR.
 */
export function AudioRecorder({ tenantSlug, conversationId, disabled, onSend }: Props) {
  const submit = useSubmit()
  const [supported, setSupported] = useState(false)
  const [status, setStatus] = useState<RecState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Detecção de suporte só no cliente — evita divergência de hidratação (no SSR
  // não existe navigator/MediaRecorder).
  useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof MediaRecorder !== 'undefined',
    )
  }, [])

  // Libera a URL de preview ao desmontar.
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  // Garante que o microfone é liberado se o componente desmontar no meio da
  // gravação (senão o stream do getUserMedia continua ligado e o mic fica aceso).
  // Lê os refs no cleanup — sem deps, roda só no unmount, nunca corta uma gravação viva.
  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop()
      }
      for (const track of streamRef.current?.getTracks() ?? []) {
        track.stop()
      }
      streamRef.current = null
    }
  }, [])

  function stopStream() {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop()
    }
    streamRef.current = null
  }

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        blobRef.current = blob
        setPreviewUrl((old) => {
          if (old) {
            URL.revokeObjectURL(old)
          }
          return URL.createObjectURL(blob)
        })
        setStatus('recorded')
        stopStream()
      }
      recorder.start()
      recorderRef.current = recorder
      setStatus('recording')
    } catch {
      setError('Não consegui acessar o microfone. Verifique a permissão do navegador.')
      setStatus('idle')
      stopStream()
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
  }

  function discard() {
    blobRef.current = null
    setPreviewUrl((old) => {
      if (old) {
        URL.revokeObjectURL(old)
      }
      return null
    })
    setStatus('idle')
  }

  function send() {
    const blob = blobRef.current
    // Blob de 0 byte é truthy: sem checar size, mandaríamos um áudio vazio que o
    // servidor rejeita silenciosamente. Barra aqui e avisa o usuário.
    if (!blob || blob.size === 0) {
      setError('A gravação saiu vazia. Tente de novo, falando mais perto do microfone.')
      return
    }
    setError(null)
    // Extensão a partir do mime (ex.: "audio/webm;codecs=opus" -> "webm").
    const ext = (blob.type.split('/')[1] ?? 'webm').split(';')[0] || 'webm'
    const file = new File([blob], `gravacao.${ext}`, { type: blob.type })
    const formData = new FormData()
    formData.append('tenantSlug', tenantSlug)
    if (conversationId) {
      formData.append('conversationId', conversationId)
    }
    formData.append('audio', file)
    onSend()
    submit(formData, { method: 'post', encType: 'multipart/form-data' })
    discard()
  }

  if (!supported) {
    return (
      <p className="text-xs text-gray-500">
        Seu navegador não permite gravar áudio aqui. Use o envio de arquivo abaixo.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {status === 'idle' && (
        <button
          type="button"
          onClick={startRecording}
          disabled={disabled}
          className={`rounded border border-gray-300 px-3 py-2 text-sm font-medium ${
            disabled ? 'cursor-not-allowed opacity-60' : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          🎤 Gravar áudio
        </button>
      )}

      {status === 'recording' && (
        <button
          type="button"
          onClick={stopRecording}
          className="flex items-center gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
        >
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
          Parar gravação
        </button>
      )}

      {status === 'recorded' && previewUrl && (
        <div className="flex flex-wrap items-center gap-2">
          {/* biome-ignore lint/a11y/useMediaCaption: preview de áudio gravado pelo próprio usuário */}
          <audio controls src={previewUrl} className="h-9" />
          <button
            type="button"
            onClick={send}
            disabled={disabled}
            className={`rounded px-3 py-2 text-sm font-semibold text-white ${
              disabled ? 'cursor-not-allowed bg-blue-400' : 'bg-blue-600'
            }`}
          >
            Enviar áudio
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={disabled}
            className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-600"
          >
            Descartar
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
