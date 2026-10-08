#!/usr/bin/env python3
"""Merge a WinacuxOS LoRA adapter into its base model and write a plain HF model.

Why this exists: MLX trains the adapter in 4-bit for memory reasons, and its own
converter only speaks MLX. But WinacuxOS ships a llama.cpp server, which speaks
GGUF. So we:

    load 4-bit base -> attach adapter -> fold B@A*scale into W
    -> dequantize to bf16 -> save a normal HF checkpoint

and ai/scripts/export-gguf.sh turns that checkpoint into Q4_K_M GGUF.

Run after ai/scripts/train.sh:

    python3 ai/scripts/merge_and_quantize.py
"""

import argparse
import json
import pathlib
import shutil
import sys

import mlx.core as mx
import mlx.nn as nn

ROOT = pathlib.Path(__file__).resolve().parents[2]


def find_lora_layers(model):
    """Return every LoRALinear-style module in the model."""
    found = []
    for module in model.modules():
        if hasattr(module, "lora_a") and hasattr(module, "lora_b"):
            found.append(module)
    return found


def merge_layer(layer):
    """W += (B @ A) * scale, in the module's own quantised dtype."""
    scale = getattr(layer, "scale", 1.0)

    a = layer.lora_a
    b = layer.lora_b
    if isinstance(a, dict):
        # Quantised LoRA: gather every expert/group variant.
        delta = mx.zeros_like(layer.weight)
        for key_a, mat_a in a.items():
            mat_b = b[key_a]
            delta += (mat_b @ mat_a).astype(delta.dtype) * scale
        layer.weight = (layer.weight + delta).astype(layer.weight.dtype)
    else:
        delta = (b @ a).astype(layer.weight.dtype) * scale
        layer.weight = (layer.weight + delta).astype(layer.weight.dtype)

    # Detach the adapter so nothing re-applies it on save or inference.
    layer.lora_a = None
    layer.lora_b = None
    layer.scale = 1.0
    return layer


def unfuse(model):
    """Convert fused LoRA layers back into plain quantized linears."""
    lora_layers = find_lora_layers(model)
    for layer in lora_layers:
        plain = nn.QuantizedLinear(layer.in_features, layer.out_features,
                                   bias=hasattr(layer, "bias"),
                                   bits=getattr(layer, "bits", 4),
                                   group_size=getattr(layer, "group_size", 64))
        plain.weight = layer.weight
        plain.scales = layer.scales
        plain.biases = layer.biases
        layer.__class__ = plain.__class__
        for name, value in vars(plain).items():
            setattr(layer, name, value)
    return len(lora_layers)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True, help="base model directory")
    parser.add_argument("--adapter", required=True, help="adapter directory from mlx_lm.lora")
    parser.add_argument("--out", required=True, help="merged HF model directory")
    args = parser.parse_args()

    from mlx_lm.utils import dequantize_model, load_model, save_model, load_adapters

    base = pathlib.Path(args.base)
    adapter = pathlib.Path(args.adapter)
    out = pathlib.Path(args.out)

    if not (base / "config.json").exists():
        sys.exit(f"base model not found: {base}")
    if not adapter.exists():
        sys.exit(f"adapter not found: {adapter}")

    print(f"==> loading base {base.name}")
    model, config = load_model(str(base))

    print(f"==> applying adapter {adapter.name}")
    model = load_adapters(model, str(adapter))

    lora_layers = find_lora_layers(model)
    if not lora_layers:
        sys.exit("no LoRA layers found - was the adapter trained with mlx_lm.lora?")
    print(f"==> merging {len(lora_layers)} LoRA layers")

    for layer in lora_layers:
        merge_layer(layer)
    print(f"==> unfusing adapters")
    unfuse(model)

    print("==> dequantizing to bf16")
    model = dequantize_model(model)

    print(f"==> saving merged model to {out}")
    out.mkdir(parents=True, exist_ok=True)
    save_model(str(out), model, config)

    # Config, tokenizer and chat template must come from the base repo, because
    # MLX community repos ship them but save_model only writes weights.
    for name in ("config.json", "tokenizer.json", "tokenizer_config.json",
                 "vocab.json", "merges.txt", "special_tokens_map.json",
                 "added_tokens.json", "tokenizer.model", "chat_template.jinja"):
        source = base / name
        if source.exists():
            shutil.copy2(source, out / name)
    generation = {
        "bos_token_id": 151643,
        "eos_token_id": [151645, 151643],
        "pad_token_id": 151643,
        "do_sample": True,
        "temperature": 0.7,
        "top_p": 0.9,
    }
    (out / "generation_config.json").write_text(json.dumps(generation, indent=2))

    # Sanity check: the merged model must still generate text.
    print("==> sanity check")
    from mlx_lm import generate
    prompt = "<|im_start|>user\nWhat is Winacux Flow?<|im_end|>\n<|im_start|>assistant\n"
    answer = generate(model, prompt, max_tokens=60, verbose=False)
    print("    model says:", answer.strip().replace("\n", " ")[:200])

    print(f"==> done: {out}")


if __name__ == "__main__":
    main()