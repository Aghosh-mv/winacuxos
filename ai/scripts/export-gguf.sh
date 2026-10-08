#!/usr/bin/env bash
# Export the merged WinacuxOS model to GGUF (Q4_K_M) for the llama.cpp server
# that ships inside the ISO.
#
#   ai/scripts/export-gguf.sh
#
# Produces ai/out/winacuxos-assistant-q4_k_m.gguf, which the build hook bakes
# into the image.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MERGED="$ROOT/ai/out/merged"
GGUF_DIR="$ROOT/ai/out/gguf"
LLAMA_DIR="$ROOT/ai/out/llama.cpp"
OUT="$ROOT/ai/out/winacuxos-assistant-q4_k_m.gguf"
VENV="$ROOT/ai/.venv"
LLAMA_REPO="https://github.com/ggml-org/llama.cpp"
LLAMA_TAG="b4586"

[ -d "$MERGED" ] || { echo "!! run merge_and_quantize.py first (missing $MERGED)" >&2; exit 1; }

# numpy is all convert_hf_to_gguf needs; torch only appears for exotic archs.
"$VENV/bin/python" -c "import numpy" 2>/dev/null || \
    VIRTUAL_ENV="$VENV" uv pip install -q numpy

if [ ! -d "$LLAMA_DIR" ]; then
    echo "==> fetching llama.cpp $LLAMA_TAG"
    git clone --depth 1 --branch "$LLAMA_TAG" "$LLAMA_REPO" "$LLAMA_DIR"
fi

echo "==> HF -> GGUF (f16)"
mkdir -p "$GGUF_DIR"
"$VENV/bin/python" "$LLAMA_DIR/convert_hf_to_gguf.py" \
    "$MERGED" \
    --outfile "$GGUF_DIR/winacuxos-assistant-f16.gguf" \
    --outtype f16

echo "==> quantising to Q4_K_M"
cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build" -DCMAKE_BUILD_TYPE=Release \
    -DLLAMA_CURL=OFF -DGGML_NATIVE=OFF >/dev/null
cmake --build "$LLAMA_DIR/build" -j "$(sysctl -n hw.ncpu)" --target llama-quantize >/dev/null

mkdir -p "$(dirname "$OUT")"
"$LLAMA_DIR/build/bin/llama-quantize" \
    "$GGUF_DIR/winacuxos-assistant-f16.gguf" "$OUT" Q4_K_M

ls -lh "$OUT"
echo "==> GGUF ready: $OUT"
echo "    bake it with: WINACUX_MODEL=$OUT scripts/build.sh"