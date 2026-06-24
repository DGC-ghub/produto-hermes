import { describe, expect, it } from 'vitest'
import {
  cleanTranscript,
  isSupportedAudioExtension,
  parseTranscriptionOutput,
} from './transcribe.server'

describe('isSupportedAudioExtension', () => {
  it('aceita formatos comuns de áudio (inclusive nota de WhatsApp .ogg)', () => {
    expect(isSupportedAudioExtension('nota.ogg')).toBe(true)
    expect(isSupportedAudioExtension('audio.mp3')).toBe(true)
    expect(isSupportedAudioExtension('voz.m4a')).toBe(true)
    expect(isSupportedAudioExtension('gravacao.opus')).toBe(true)
  })

  it('é case-insensitive', () => {
    expect(isSupportedAudioExtension('NOTA.OGG')).toBe(true)
    expect(isSupportedAudioExtension('Audio.Mp3')).toBe(true)
  })

  it('rejeita extensão não suportada ou ausente', () => {
    expect(isSupportedAudioExtension('documento.txt')).toBe(false)
    expect(isSupportedAudioExtension('foto.png')).toBe(false)
    expect(isSupportedAudioExtension('semextensao')).toBe(false)
  })

  it('considera a última extensão em nomes com pontos', () => {
    expect(isSupportedAudioExtension('voz.note.m4a')).toBe(true)
    expect(isSupportedAudioExtension('arquivo.mp3.txt')).toBe(false)
  })
})

describe('cleanTranscript', () => {
  it('colapsa espaços e quebras de linha e remove pontas', () => {
    expect(cleanTranscript('  bom   dia\n\n pessoal  ')).toBe('bom dia pessoal')
  })

  it('trunca em um teto defensivo', () => {
    const result = cleanTranscript('a'.repeat(5000))
    expect(result.length).toBe(4000)
  })

  it('texto só de espaços vira string vazia', () => {
    expect(cleanTranscript('   \n\t  ')).toBe('')
  })
})

describe('parseTranscriptionOutput', () => {
  it('extrai e limpa um JSON válido', () => {
    const result = parseTranscriptionOutput(
      '{"text": "  Olá   mundo ", "language": "pt", "duration": 3.4, "model": "base"}',
    )
    expect(result).toEqual({ text: 'Olá mundo', language: 'pt', duration: 3.4, model: 'base' })
  })

  it('tolera lixo ao redor do JSON (warnings que vazem pro stdout)', () => {
    const result = parseTranscriptionOutput(
      'Warning: algo\n{"text": "oi", "language": "pt", "duration": 1, "model": "base"}\n',
    )
    expect(result.text).toBe('oi')
  })

  it('preenche defaults quando campos secundários faltam ou têm tipo errado', () => {
    const result = parseTranscriptionOutput('{"text": "oi", "duration": "x"}')
    expect(result.text).toBe('oi')
    expect(result.language).toBe('unknown')
    expect(result.duration).toBe(0)
  })

  it('lança quando não há JSON reconhecível', () => {
    expect(() => parseTranscriptionOutput('sem json aqui')).toThrow()
  })

  it('lança quando falta o campo text', () => {
    expect(() => parseTranscriptionOutput('{"language": "pt"}')).toThrow()
  })
})
