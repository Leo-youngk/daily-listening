# -*- coding: utf-8 -*-
"""基于 OPUS-MT + CTranslate2 的离线英译中运行时。"""
from __future__ import annotations

import os
import re
import sys
import tempfile
from collections.abc import Iterable

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR_DIR = os.path.join(HERE, ".vendor")
# SentencePiece 的 Windows 原生库无法打开包含中文的模型路径，故放到纯英文临时目录。
MODEL_ROOT = os.path.join(tempfile.gettempdir(), "daily-listening-models")
SOURCE_MODEL_DIR = os.path.join(MODEL_ROOT, "opus-mt-en-zh-hf")
CT2_MODEL_DIR = os.path.join(MODEL_ROOT, "opus-mt-en-zh-ct2")
TARGET_PREFIX = ">>cmn_Hans<< "
CJK_RE = re.compile(r"[\u3400-\u9fff]")


class TranslationError(RuntimeError):
    """翻译结果不完整或运行时不可用。"""


def _load_dependencies():
    if VENDOR_DIR not in sys.path:
        sys.path.insert(0, VENDOR_DIR)
    try:
        import ctranslate2
        import transformers
    except ImportError as exc:
        raise TranslationError(
            "缺少离线翻译依赖，请先运行 python scripts/prepare_translation_model.py"
        ) from exc
    return ctranslate2, transformers


class OfflineTranslator:
    def __init__(self, device: str | None = None) -> None:
        ctranslate2, transformers = _load_dependencies()
        if not ctranslate2.contains_model(CT2_MODEL_DIR):
            raise TranslationError(
                "缺少离线翻译模型，请先运行 python scripts/prepare_translation_model.py"
            )

        # Windows 驱动可能能枚举 CUDA 设备，但实际缺少 cublas 运行库；这种状态有时
        # 不是立即抛错而是在首批推理中永久等待。批处理任务默认使用可预测的 CPU，
        # 只有显式设置 DAILY_TRANSLATION_DEVICE=cuda 才启用显卡。
        selected_device = device or os.environ.get("DAILY_TRANSLATION_DEVICE", "cpu")
        if selected_device not in {"cpu", "cuda"}:
            raise TranslationError(f"不支持的翻译设备：{selected_device}")
        compute_type = "float16" if selected_device == "cuda" else "int8_float32"
        self.tokenizer = transformers.AutoTokenizer.from_pretrained(
            SOURCE_MODEL_DIR,
            local_files_only=True,
        )
        self._ctranslate2 = ctranslate2
        self.runtime = self._create_runtime(selected_device, compute_type)
        self.device = selected_device

    def _create_runtime(self, device: str, compute_type: str):
        return self._ctranslate2.Translator(
            CT2_MODEL_DIR,
            device=device,
            compute_type=compute_type,
            inter_threads=1,
        )

    def _run_batch(self, source_tokens: list[list[str]], batch_size: int):
        try:
            return self.runtime.translate_batch(
                source_tokens,
                beam_size=4,
                max_batch_size=batch_size,
                batch_type="examples",
            )
        except RuntimeError as exc:
            # 显卡驱动存在但 CUDA 运行库缺失时，CTranslate2 会在首次推理才报错。
            if self.device != "cuda" or "cublas" not in str(exc).lower():
                raise
            self.runtime = self._create_runtime("cpu", "int8_float32")
            self.device = "cpu"
            return self.runtime.translate_batch(
                source_tokens,
                beam_size=4,
                max_batch_size=batch_size,
                batch_type="examples",
            )

    def translate(self, texts: Iterable[str], batch_size: int = 48) -> list[str]:
        source_texts = [str(text).strip() for text in texts]
        if not source_texts:
            return []
        if any(not text for text in source_texts):
            raise TranslationError("拒绝翻译空英文字幕")

        outputs: list[str] = []
        for offset in range(0, len(source_texts), batch_size):
            chunk = source_texts[offset:offset + batch_size]
            source_tokens = [
                self.tokenizer.convert_ids_to_tokens(
                    self.tokenizer.encode(TARGET_PREFIX + text, add_special_tokens=True)
                )
                for text in chunk
            ]
            results = self._run_batch(source_tokens, batch_size)
            if len(results) != len(chunk):
                raise TranslationError(
                    f"翻译批次返回数量错误：期望 {len(chunk)}，实际 {len(results)}"
                )
            for source, result in zip(chunk, results):
                token_ids = self.tokenizer.convert_tokens_to_ids(result.hypotheses[0])
                translated = self.tokenizer.decode(
                    token_ids,
                    skip_special_tokens=True,
                    clean_up_tokenization_spaces=True,
                ).strip()
                if not translated or not CJK_RE.search(translated):
                    raise TranslationError(
                        f"翻译结果无有效中文：{source[:80]!r} -> {translated[:80]!r}"
                    )
                outputs.append(translated)
            if len(source_texts) > batch_size:
                print(
                    f"  本地翻译 {min(offset + len(chunk), len(source_texts))}/{len(source_texts)}",
                    flush=True,
                )
        return outputs
