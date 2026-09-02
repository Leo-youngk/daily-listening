# scripts 说明

这里是语料管线。**下次数据出问题，先跑 `validate_data.py` 定位，再回到对应环节。**

历史上的一次性救火脚本（针对某几篇的补抓、补译、换音源）已经归档到 `oneoff/`，
它们只对当时那批具体条目有意义，不要拿来处理新问题。

## 常用入口

| 命令 | 用途 |
| --- | --- |
| `python scripts/validate_data.py` | 校验 `public/data` 的全部结构不变量。CI 闸门，改完数据必跑 |
| `python scripts/sync_dist.py` | 构建后把素材同步进 `app/dist`（vite 的 `copyPublicDir` 已关） |
| `python scripts/verify_deploy.py` | 线上验收：素材完整性、缓存版本、404 行为、查词接口 |

## 语料管线

按顺序，从选题到上线：

1. `build_ted_corpus.py` — 从 Kaggle `ted_main.csv` 按播放量取 TOP 100
2. `resolve.py` — 把清单解析成实际 YouTube 视频（频道 / 时长 / 标题三重校验）→ `resolved.json`
3. `fetch.py` — 按 `resolved.json` 下载音频 + json3 字幕 + 元信息，支持断点续抓
4. `ingest.py` — VOA / BBC 6 Minute English 的统一抓取驱动（下载 → 转码 m4a → 强制对齐）
5. `align.py` — 无时间轴的官方文字稿强制对齐到音频，产出与 json3 同构的文件
6. `vtt2json.py` — json3 转逐句双语 JSON，缺中文的用机译补齐，并生成 manifest
7. `align_words.py` — 给每句补词级时间轴 `w[]`，并用真实首尾词时间修正 `start` / `end`
8. `fetch_ted_zh_subs.py` — 用 TED 官网的人工翻译替换机器翻译（含逐篇时间轴定标）
9. `fill_covers.py` → `localize_covers.py` — 补封面，再把图从 YouTube 图床搬到本地
10. `deploy_audio_r2.py` → `update_media_manifest.py` — 音频转码上传 R2，回写真实时长与版本化 URL
11. `rebuild_manifest.py` — 清理孤儿数据文件并重建 manifest

## 词典

- `fetch_ecdict.py` — 下载 ECDICT 词库到 `scripts/.vendor`（已 gitignore）
- `build_dict.py` — 生成"只覆盖本语料"的精简离线词典分片

## 翻译

- `prepare_translation_model.py` — 下载并转换离线英译中模型（OPUS-MT + CTranslate2）
- `offline_translate.py` — 离线翻译运行时
- `repair_translations.py` — 只回填空中文，不覆盖任何有效译文

## 其它

- `make_icons.py` — 生成 PWA 图标
- `import_cloudflare_env.ps1` — 从本地配置导入 Cloudflare 环境变量

## 写数据的唯一入口

**所有写 `public/data/<slug>.json` 的脚本都必须走 `data_io.write_talk`**，不要自己 `json.dump`。

格式约定：单篇用 `indent=2` 展开到句级（改一句话的 diff 就只有几行，出问题能用 git 直接定位），
但词级时间轴 `w` 压回一行——它是一串纯数字，展开会把单篇从 250 行撑到 1300 行，反而更难读。
`manifest.json` 整体紧凑，它是列表页一次性拉取的，没人读它的 diff。

`validate_data.py` 会检查这套格式，写歪了 CI 会拦下来。

## 已知约束

- **不要并发写 `public/data/*.json`。** `align_words.py` 会"读入整篇 → 跑几分钟 ASR → 整篇写回"，
  这期间别的脚本对同一批文件的修改会被覆盖。曾经因此丢过一轮中文字幕修复，
  也撞出过 `OSError: [Errno 22]`。要串行跑。
- `align_words.py` 的并发度受内存限制：每个 worker 常驻一份 whisper，16 GB 机器上 `--jobs 5`
  会在后半程集体 `mkl_malloc` 失败，`--jobs 2` 稳定。
- `Sentence.w[]` 的下标必须与前端 `tokenizeSentence`（`app/src/lib/lookup.ts` 的 `WORD_RE`）
  分出的词一一对应。改任何一端都要同步改另一端，`validate_data.py` 会卡住不一致的情况。
