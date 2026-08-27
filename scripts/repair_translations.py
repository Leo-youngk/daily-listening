# -*- coding: utf-8 -*-
"""只回填现有数据中的空中文，不覆盖任何有效译文。"""
from __future__ import annotations

import argparse
import json
import os
import tempfile

from offline_translate import OfflineTranslator, TranslationError

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "public", "data")
CACHE_PATH = os.path.join(HERE, "corpus", "trans_cache.json")


def load_json(path: str):
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def write_json_atomic(path: str, value, *, compact: bool = False) -> None:
    directory = os.path.dirname(path)
    handle, temp_path = tempfile.mkstemp(prefix=".dtl-", suffix=".json", dir=directory)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as file:
            json.dump(
                value,
                file,
                ensure_ascii=False,
                separators=(",", ":") if compact else None,
            )
            file.write("\n")
        os.replace(temp_path, path)
    except Exception:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        raise


def data_files() -> list[str]:
    return [
        os.path.join(DATA_DIR, name)
        for name in sorted(os.listdir(DATA_DIR))
        if name.endswith(".json") and name != "manifest.json"
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="仅翻译前 N 条缺失文本（用于冒烟测试）")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    args = parser.parse_args()

    files = data_files()
    cache = load_json(CACHE_PATH) if os.path.exists(CACHE_PATH) else {}
    # 历史空值会让旧程序误以为已命中缓存，必须彻底剔除。
    cache = {str(key): str(value).strip() for key, value in cache.items() if str(value).strip()}

    missing: list[str] = []
    seen: set[str] = set()
    affected = 0
    cache_hits = 0
    for path in files:
        data = load_json(path)
        file_missing = 0
        for sentence in data.get("sentences", []):
            if str(sentence.get("zh", "")).strip():
                continue
            source = str(sentence.get("en", "")).strip()
            if not source:
                raise TranslationError(f"英文字幕为空：{os.path.basename(path)} #{sentence.get('i')}")
            file_missing += 1
            if source in cache:
                cache_hits += 1
            elif source not in seen:
                missing.append(source)
                seen.add(source)
        if file_missing:
            affected += 1

    selected = missing[:args.limit] if args.limit else missing
    print(
        f"扫描 {len(files)} 篇，{affected} 篇有空译文；"
        f"需新增翻译 {len(selected)} 条（缓存已命中 {cache_hits} 条）",
        flush=True,
    )

    if selected:
        translator = OfflineTranslator(device=args.device)
        checkpoint = 480
        for offset in range(0, len(selected), checkpoint):
            chunk = selected[offset:offset + checkpoint]
            translated = translator.translate(chunk)
            if len(translated) != len(chunk) or any(not value.strip() for value in translated):
                raise TranslationError("翻译批次存在空值或数量错位，拒绝写入")
            cache.update(zip(chunk, translated))
            write_json_atomic(CACHE_PATH, cache, compact=True)
            print(
                f"翻译 {min(offset + len(chunk), len(selected))}/{len(selected)} "
                f"(device={translator.device})",
                flush=True,
            )

    if args.limit:
        print("冒烟模式只更新翻译缓存，不改写字幕数据。")
        return

    changed_files = 0
    filled = 0
    for path in files:
        data = load_json(path)
        original_source = data.get("zhSource", "mt")
        changed = False
        for sentence in data.get("sentences", []):
            if str(sentence.get("zh", "")).strip():
                continue
            source = str(sentence.get("en", "")).strip()
            value = cache.get(source, "").strip()
            if not value:
                raise TranslationError(
                    f"仍有空译文：{os.path.basename(path)} #{sentence.get('i')} {source[:80]!r}"
                )
            sentence["zh"] = value
            filled += 1
            changed = True
        if changed:
            if original_source == "official":
                data["zhSource"] = "mixed"
            else:
                data["zhSource"] = "mt"
            write_json_atomic(path, data, compact=True)
            changed_files += 1

    remaining = 0
    for path in files:
        data = load_json(path)
        remaining += sum(not str(sentence.get("zh", "")).strip() for sentence in data.get("sentences", []))
    if remaining:
        raise TranslationError(f"回填后仍有 {remaining} 条空中文，拒绝完成")
    print(f"完成：回填 {filled} 句，更新 {changed_files} 篇，空中文 0。")


if __name__ == "__main__":
    main()
