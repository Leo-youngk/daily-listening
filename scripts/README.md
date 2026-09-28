# scripts 说明

数据管线。**数据出问题先跑 `validate_data.py` 定位，再回到对应环节。**

## 常用入口

| 命令 | 用途 |
| --- | --- |
| `python scripts/validate_data.py` | 校验 `public/data`、词表、例句索引的全部不变量。CI 闸门，改完数据必跑 |
| `python scripts/sync_dist.py` | 构建后把素材同步进 `app/dist`（vite 的 `copyPublicDir` 已关） |
| `python scripts/verify_deploy.py` | 线上验收：节目、字幕、词表、切句原声、整集音频、缓存版本、404、查词接口 |

## 管线（按顺序）

1. `ingest.py` — 三档节目各取最新 N 期：正文 + 音频（转 m4a）+ 强制对齐 + 封面。
   对齐失败的期数自动顺延取下一期，直到凑满。断点续抓（`corpus/ingest_state.json`）。
   官方文稿原样留底在 `corpus/transcripts/`，改进对齐算法后 `--realign` 重跑不用联网。
2. `build_talks.py` — 对齐结果切成逐句数据，Gemini 整集翻译，写 `public/data/<slug>.json` 与 manifest；
   不在本批节目里的旧数据会被清掉。`--translate-only` 只填翻译缓存，可以和 ingest 同时跑。
3. `align_words.py` — 每句补词级时间轴 `w[]`（复用 ingest 存下的 ASR 词序列，不再识别第二遍）。
4. `build_vocab.py` — 六级词表、每个词最多 5 条原声例句、每集六级词索引，并把 `lemmas`（字幕上色用）写回每集数据。
5. `build_dict.py` — 只覆盖本语料的精简离线词典分片（点词查词用）。
6. `cut_clips.py` — 每句切成独立小音频上传 R2（`v1/clips/<slug>/<句子下标>-<起点厘秒>.m4a`）。
7. `deploy_audio_r2.py` — 整集音频上传 R2：高音质是原始 m4a，标准音质转成 64kbps 单声道 CBR MP3（m4a 起播前要先下完 moov 索引，长节目有 240~300KB；MP3 没有这张表，下到几 KB 就能出声）。
   前端经 Pages Functions 的 `/audio/*`（`app/functions/audio`）同源读 R2，不再单独握手一个音频域名；本地 `vite dev` 由 `vite.config.ts` 的 `localAudio` 映射到本机文件。

节目源适配器在 `sources/`：`bbc6min.py`、`curious.py`、`thinking.py`，网络请求统一走 `sources/common.py`（带退避重试）。

## 翻译（Gemini 免费层）

key 放仓库根目录 `.env.google.local`（`GOOGLE_API_KEY=...`，已 gitignore）。
免费层按模型限每天请求数（flash 约 20 次/天），`translate.py` 按质量排了一串 Gemini 3.x 模型轮流用，
某个模型当天额度用完自动换下一个并打印提示；每集用的模型记在数据的 `zhModel` 字段。
全部模型当天都用完时构建会停下，已翻完的都在 `corpus/zh/` 缓存里，第二天接着跑。
小模型偶尔把英文原样吐回来（句数照样对得上）：译文九成句子要含汉字才算数，同一模型连续两次照抄就换下一个；`validate_data.py` 也会拦下没翻译的期。
flash-lite 这类小模型对长列表常漏句/并句：同一块连续 2 次句数对不上，就对半拆开递归重翻（块首带前文做上下文），不会卡死在重试上。

## GPU 对齐

faster-whisper 在本机 RTX 3050 上约 13 倍实时，CPU 只有约 1 倍。CUDA 运行库（cuBLAS、cuDNN）用 pip 装在
`scripts/.vendor/cuda`（已 gitignore）：

```powershell
python -m pip install --target scripts/.vendor/cuda nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
```

`align.py` 启动时会把这两个目录加进 DLL 搜索路径；找不到时退回 CPU 并打印提示。
参考文本已知，ASR 只取词时间，所以用贪心解码（`beam_size=1`）：比默认 beam 5 快一个数量级（一集 25 分钟约 30 秒），匹配率仍在 0.95 以上。

## 写数据的唯一入口

**所有写 `public/data/<slug>.json` 的脚本都必须走 `data_io.write_talk`**，不要自己 `json.dump`。
单篇 `indent=2` 展开到句级，词级时间轴 `w` 压成一行；`manifest.json` 整体紧凑。`validate_data.py` 会检查格式。

## 已知约束

- **不要并发写 `public/data/*.json`**：`build_talks.py`、`align_words.py`、`build_vocab.py` 都是整篇读写，要串行跑。
- `Sentence.w[]` 的下标必须与前端 `tokenizeSentence`（`app/src/lib/lookup.ts` 的 `WORD_RE`）一一对应，
  改任何一端都要同步改另一端，`validate_data.py` 会卡住不一致。
- 例句索引里的句子起点必须与数据一致（切句原声按起点命名）；改了数据要依次重跑 `build_vocab.py`、`cut_clips.py`。
- BBC 列表页的老期数（约 2022 年以前）页面结构不同，`bbc6min.py` 解析不出正文；只取最近 N 期时不受影响。
