#!/usr/bin/env bash
# 翻译齐了之后的整条上线前管线：重建数据 -> 切句原声 -> 上传音频 -> 校验。任何一步失败立刻停下。
set -euo pipefail
cd "$(dirname "$0")"
step() { echo "== [$(date +%H:%M)] $*"; }
step build_talks;     python -u build_talks.py
step align_words;     python -u align_words.py
step build_vocab;     python -u build_vocab.py
step build_dict;      python -u build_dict.py
step validate_data;   python -u validate_data.py
step cut_clips;       python -u cut_clips.py
step deploy_audio_r2; python -u deploy_audio_r2.py --ready --jobs 3
step 完成
