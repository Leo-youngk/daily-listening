# -*- coding: utf-8 -*-
"""public/data 的统一写入器。

格式约定（所有写单篇数据的脚本都必须走这里）：

- 单篇 `<slug>.json` 用 `indent=2` 展开到句级，这样改一句话的 diff 就只有几行，
  数据出问题时能靠 git 直接看出来是哪句变了。
- 但词级时间轴 `w` 压回一行。它是一串纯数字（一句 20 个词就是 40 个数），
  按 indent=2 展开会让单篇从 250 行涨到 1300 行，全是裸数字，比不展开还难读。
- `manifest.json` 整体紧凑：它是列表页一次性拉取的，没人会去读它的 diff，
  展开只会白白增加首屏体积。
- 一律 `ensure_ascii=False` + LF 换行 + 结尾换行。

`validate_data.py` 会检查这套格式，跑偏了 CI 会拦下来。
"""
import io
import os
import json
import re
import time

# "w": [ 1.2, 3.4 ] -> "w": [1.2,3.4]
_W_ARRAY = re.compile(r'"w":\s*\[([\s\d.,eE+-]*?)\]')


def talk_json(talk) -> str:
    text = json.dumps(talk, ensure_ascii=False, indent=2)
    text = _W_ARRAY.sub(lambda m: '"w": [' + re.sub(r"\s+", "", m.group(1)) + "]", text)
    return text + "\n"


def write_talk(path, talk) -> None:
    # 先写临时文件再替换：cut_clips 等只读脚本可以和构建同时跑，不会读到写了一半的文件
    path = os.fspath(path)
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(talk_json(talk))
    # Windows 上目标文件正被别的进程读（dev server 监听、杀毒扫描）时 replace 会拒绝访问，稍等重试
    for attempt in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.25)


def write_manifest(path, items) -> None:
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(items, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
