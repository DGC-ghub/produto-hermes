#!/usr/bin/env bash
# Cria o venv isolado de transcrição (faster-whisper) usado pela fase 2.5.
# O venv NÃO é versionado (.gitignore) — rode este script uma vez por máquina.
#
# Requisitos: uv (https://docs.astral.sh/uv/) e ffmpeg no PATH.
# Uso: bash scripts/setup-transcribe.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v uv >/dev/null 2>&1; then
  echo "erro: 'uv' não encontrado no PATH. Instale: https://docs.astral.sh/uv/" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "aviso: 'ffmpeg' não encontrado — faster-whisper precisa dele para decodificar áudio." >&2
fi

if [ -d .venv-transcribe ]; then
  echo "==> venv .venv-transcribe já existe (pulando criação)"
else
  echo "==> criando venv .venv-transcribe"
  uv venv .venv-transcribe
fi

echo "==> instalando faster-whisper"
uv pip install --python .venv-transcribe faster-whisper

echo "==> teste rápido do import"
.venv-transcribe/bin/python -c "import faster_whisper; print('faster-whisper', faster_whisper.__version__, 'OK')"

echo
echo "Pronto. O modelo (WHISPER_MODEL, default 'base') é baixado na 1ª transcrição."
echo "Teste com:  .venv-transcribe/bin/python scripts/transcribe.py <arquivo_de_audio>"
