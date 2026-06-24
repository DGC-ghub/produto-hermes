#!/usr/bin/env python3
"""Transcreve um arquivo de áudio para texto usando faster-whisper.

Uso:
    python scripts/transcribe.py <caminho_do_audio>

Saída (stdout): um único objeto JSON
    {"text": "...", "language": "pt", "duration": 3.4, "model": "base"}

Em erro: mensagem em stderr e código de saída != 0.

O modelo e a língua são configuráveis por ambiente:
    WHISPER_MODEL  (default "base")   — tiny | base | small | medium ...
    WHISPER_LANG   (default "pt")     — vazio = detecção automática
    WHISPER_COMPUTE (default "int8")  — tipo de cómputo do CTranslate2

Este script é a "borda" de transcrição: roda isolado, sem tocar no produto.
O lado Node (transcribe.server.ts) só o invoca e lê o JSON.
"""

import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("uso: transcribe.py <caminho_do_audio>", file=sys.stderr)
        return 2

    audio_path = sys.argv[1]
    if not os.path.isfile(audio_path):
        print(f"arquivo não encontrado: {audio_path}", file=sys.stderr)
        return 2

    model_size = os.environ.get("WHISPER_MODEL", "base")
    language = os.environ.get("WHISPER_LANG", "pt") or None
    compute_type = os.environ.get("WHISPER_COMPUTE", "int8")

    # Import tardio: só paga o custo quando realmente vai transcrever.
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type=compute_type)

    # vad_filter remove silêncios/ruído antes da decodificação — melhora a
    # precisão em áudios de WhatsApp (que vêm com pausas e respiração).
    segments, info = model.transcribe(
        audio_path,
        language=language,
        vad_filter=True,
        beam_size=5,
    )

    text = "".join(segment.text for segment in segments).strip()

    json.dump(
        {
            "text": text,
            "language": info.language,
            "duration": round(info.duration, 2),
            "model": model_size,
        },
        sys.stdout,
        ensure_ascii=False,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
