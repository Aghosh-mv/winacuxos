#!/usr/bin/env bash
# Train the WinacuxOS assistant (LoRA) on Apple Silicon with MLX.
#
# What this produces: a LoRA adapter that teaches a small base model about
# WinacuxOS - its commands, Flows, features, troubleshooting and the assistant's
# personality - plus the recipe for merging it into the base and exporting GGUF
# for the ISO.
#
#   ai/scripts/train.sh [base-model-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="${1:-$ROOT/ai/models/qwen2.5-1.5b-instruct-4bit}"
DATA="$ROOT/ai/dataset"
OUT="$ROOT/ai/out"
VENV="$ROOT/ai/.venv"

[ -d "$BASE" ] || { echo "!! base model not found: $BASE" >&2; exit 1; }
[ -x "$VENV/bin/mlx_lm.lora" ] || { echo "!! venv missing: run uv venv + uv pip install mlx-lm" >&2; exit 1; }

mkdir -p "$DATA" "$OUT"

# mlx-lm expects a directory with train/valid jsonl files.
if [ ! -f "$DATA/train.jsonl" ]; then
    python3 "$ROOT/ai/scripts/gen_dataset.py" > "$DATA/winacux.jsonl"
    total=$(wc -l < "$DATA/winacux.jsonl" | tr -d ' ')
    valid=$(( total / 10 + 1 ))
    head -n "$valid" "$DATA/winacux.jsonl" > "$DATA/valid.jsonl"
    tail -n "+$((valid + 1))" "$DATA/winacux.jsonl" > "$DATA/train.jsonl"
    echo "==> dataset: $(wc -l < "$DATA/train.jsonl" | tr -d ' ') train / \
$(wc -l < "$DATA/valid.jsonl" | tr -d ' ') valid"
fi

echo "==> training LoRA on $BASE"
"$VENV/bin/mlx_lm.lora" \
    --model "$BASE" \
    --data "$DATA" \
    --adapter-path "$OUT/adapter" \
    --iters 400 \
    --batch-size 4 \
    --grad-accumulation-steps 2 \
    --learning-rate 1e-4 \
    --num-layers 12 \
    --mask-prompt \
    --steps-per-report 25 \
    --steps-per-eval 100 \
    --seed 7 \
    2>&1 | tee "$OUT/train.log"

echo "==> adapter written to $OUT/adapter"
echo "==> next: ai/scripts/merge-and-quantize.sh"