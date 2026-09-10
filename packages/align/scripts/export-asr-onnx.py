#!/usr/bin/env python3
"""Export a wav2vec2 CTC model to the layout Transformers.js loads.

Output layout (docs/lyrics-sync-functionality-implementation-plan.md §6 M7):
    <out>/config.json, preprocessor_config.json, tokenizer_config.json,
    vocab.json, special_tokens_map.json, tokenizer.json (generated),
    onnx/model.onnx (fp32), onnx/model_quantized.onnx (dynamic int8 = "q8")

Run it once, outside Bun, in a venv with `optimum[exporters,onnxruntime] torch`:
    python3 packages/align/scripts/export-asr-onnx.py facebook/wav2vec2-large-960h-lv60-self out/en
Then upload `out/en` to Hugging Face and point `MODELS.asr` (or `MUSICBUTLER_ASR_*`) at it.
"""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

CONFIG_FILES = [
    "config.json",
    "preprocessor_config.json",
    "tokenizer_config.json",
    "vocab.json",
    "special_tokens_map.json",
]


def build_tokenizer_json(vocab: dict, tok_cfg: dict) -> dict:
    """Mirror of the tokenizer.json that the Xenova exports ship for Wav2Vec2CTCTokenizer."""
    delim = tok_cfg.get("word_delimiter_token", "|")
    specials = [tok_cfg.get(k) for k in ("pad_token", "bos_token", "eos_token", "unk_token")]
    added = [
        {
            "id": vocab[t],
            "content": t,
            "single_word": False,
            "lstrip": True,
            "rstrip": True,
            "normalized": False,
            "special": True,
        }
        for t in specials
        if t and t in vocab
    ]
    return {
        "version": "1.0",
        "truncation": None,
        "padding": None,
        "added_tokens": added,
        "normalizer": {"type": "Replace", "pattern": {"String": " "}, "content": delim},
        "pre_tokenizer": {
            "type": "Split",
            "pattern": {"Regex": ""},
            "behavior": "Isolated",
            "invert": False,
        },
        "post_processor": None,
        "decoder": {
            "type": "CTC",
            "pad_token": tok_cfg.get("pad_token", "<pad>"),
            "word_delimiter_token": delim,
            "cleanup": True,
        },
        "model": {"vocab": vocab},
    }


def quantize(out: Path) -> None:
    """fp32 onnx/model.onnx -> onnx/model_quantized.onnx (dynamic uint8 weights, the "q8" dtype)."""
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.shape_inference import quant_pre_process

    src = out / "onnx" / "model.onnx"
    dst = out / "onnx" / "model_quantized.onnx"
    # wav2vec2's weight-normalised positional conv computes its weight at run time
    # (a Mul node), which the quantizer rejects ("expected ... to be an initializer").
    # Constant folding through ORT turns it into an initializer first.
    folded = out / "onnx" / "model_folded.onnx"
    try:
        quant_pre_process(str(src), str(folded), skip_symbolic_shape=True)
        quantize_dynamic(str(folded), str(dst), weight_type=QuantType.QUInt8, per_channel=False, reduce_range=False)
    except Exception as exc:  # noqa: BLE001
        print(f"constant folding path failed ({exc}); quantizing MatMul/Gemm only")
        quantize_dynamic(
            str(src), str(dst), weight_type=QuantType.QUInt8, per_channel=False, reduce_range=False,
            op_types_to_quantize=["MatMul", "Gemm"],
        )
    finally:
        for p in out.glob("onnx/model_folded.onnx*"):
            p.unlink()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("model_id", help="Hugging Face id of a PyTorch wav2vec2 CTC model")
    ap.add_argument("out_dir", help="Output directory (created)")
    ap.add_argument("--quantize-only", action="store_true", help="Skip the export; onnx/model.onnx must exist")
    args = ap.parse_args()

    out = Path(args.out_dir)
    tmp = out / "_export"
    if args.quantize_only:
        quantize(out)
        return
    subprocess.check_call(
        [
            "optimum-cli", "export", "onnx",
            "--model", args.model_id,
            "--task", "automatic-speech-recognition",
            str(tmp),
        ]
    )

    (out / "onnx").mkdir(parents=True, exist_ok=True)
    for name in CONFIG_FILES:
        if (tmp / name).exists():
            shutil.copy(tmp / name, out / name)
    shutil.move(str(tmp / "model.onnx"), str(out / "onnx" / "model.onnx"))
    for extra in tmp.glob("model.onnx_data*"):
        shutil.move(str(extra), str(out / "onnx" / extra.name))
    shutil.rmtree(tmp)
    quantize(out)

    vocab = json.load(open(out / "vocab.json", encoding="utf-8"))
    tok_cfg = json.load(open(out / "tokenizer_config.json", encoding="utf-8"))
    with open(out / "tokenizer.json", "w", encoding="utf-8") as f:
        json.dump(build_tokenizer_json(vocab, tok_cfg), f, ensure_ascii=False, indent=1)

    sizes = {p.name: p.stat().st_size // 1_000_000 for p in (out / "onnx").iterdir()}
    print(f"exported {args.model_id} -> {out}  vocab={len(vocab)}  onnx sizes (MB)={sizes}")


if __name__ == "__main__":
    main()
