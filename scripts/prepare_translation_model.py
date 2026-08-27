# -*- coding: utf-8 -*-
"""下载并转换零费用离线英译中模型。模型产物位于 Git 忽略目录。"""
from __future__ import annotations

import argparse
import os
import sys

from offline_translate import CT2_MODEL_DIR, SOURCE_MODEL_DIR, VENDOR_DIR

MODEL_ID = "Helsinki-NLP/opus-mt-en-zh"
MODEL_FILES = [
    "config.json",
    "generation_config.json",
    "pytorch_model.bin",
    "source.spm",
    "target.spm",
    "tokenizer_config.json",
    "vocab.json",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="重新下载并转换模型")
    args = parser.parse_args()

    if VENDOR_DIR not in sys.path:
        sys.path.insert(0, VENDOR_DIR)
    import ctranslate2
    from ctranslate2.converters import TransformersConverter
    from huggingface_hub import snapshot_download

    os.makedirs(os.path.dirname(SOURCE_MODEL_DIR), exist_ok=True)
    # Xet 在部分 Windows/中文路径环境会长时间卡在文件重建；标准 HTTPS 更稳定。
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    print(f"下载模型 {MODEL_ID}…", flush=True)
    snapshot_download(
        repo_id=MODEL_ID,
        local_dir=SOURCE_MODEL_DIR,
        force_download=args.force,
        allow_patterns=MODEL_FILES,
        max_workers=2,
    )

    if ctranslate2.contains_model(CT2_MODEL_DIR) and not args.force:
        print(f"CTranslate2 模型已就绪：{CT2_MODEL_DIR}")
        return

    print("转换为 CTranslate2 float16…", flush=True)
    TransformersConverter(SOURCE_MODEL_DIR, load_as_float16=True).convert(
        CT2_MODEL_DIR,
        quantization="float16",
        force=args.force,
    )
    if not ctranslate2.contains_model(CT2_MODEL_DIR):
        raise RuntimeError("模型转换完成后未发现有效 CTranslate2 产物")
    print(f"模型就绪：{CT2_MODEL_DIR}")


if __name__ == "__main__":
    main()
