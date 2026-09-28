# 待办交接（2026-09-28 暂停时）

"听 + 背六级单词"重构的全部改动都在分支 `feat/listen-vocab` 上，**还没合并 main，线上仍是旧版**。
这个分支里的 `public/data` 只有 4 期冒烟数据。全量数据生成前不要合进 main：合并会触发 CI 部署，把这 4 期发到线上。

## 当前进度

| 项目 | 状态 |
| --- | --- |
| 抓取 + 对齐 | BBC 100/100 · Curious Minds 50/50 · Thinking in English 13/50（清单见 `scripts/corpus/episodes.json`） |
| 中文翻译（Gemini） | 已入库 163 期中 146 期有缓存（`scripts/corpus/zh/`），缺 Thinking 12 期、Curious 5 期 |
| R2 整集音频 | 已传 105 期（高/标准两档），其余期还没传 |
| R2 切句原声 | 只切了冒烟 4 期 |
| 前端 | 按设计稿 G4（`output/ui-concepts/2026-09-28-content-v4/`）重做完成：今日 / 节目 / 单词 / 我的 / 播放（播放·文稿两视图）/ 搜索 / 背词 / 查词 / 各面板；typecheck、build 通过，测试 66/67（见下方 A4） |

整集音频（`public/audio`，2.1 GB）和对齐结果（`public/subs`）按 .gitignore 不进仓库，只在原来那台电脑上。

## A. 数据管线（只能在原来那台电脑跑：GPU 对齐 + 本地音频 + 密钥）

1. 补完 Thinking in English：`cd scripts && python -u ingest.py`
   - 断点续抓，已入库的期会跳过。
   - 上次被中断时留下的 `.part` 半截文件，启动时会自动清理。
2. 补齐翻译：`python build_talks.py --translate-only --workers 2`，直到所有已入库的期都有 `corpus/zh` 缓存。
   - Gemini 免费层按模型限次（flash 约 20 次/天），太平洋时间 0 点刷新。
   - 服务器过载（503）时会自动重试、换模型。
3. 按顺序生成数据并上传：
   `build_talks.py` → `align_words.py` → `build_vocab.py` → `build_dict.py` → `cut_clips.py` → `deploy_audio_r2.py --ready` → `validate_data.py`
4. 改 `app/tests/dict-data.test.ts`。
   - 词组用例（play out / nativity play / take off）要换成新语料里真实出现的词组。
   - 版本号断言等 `build_dict.py` 重建出 `ecdict-1.0.28-r2` 后才会通过。
5. `cd app && npm run typecheck && npm test && npm run lint && npm run build`，全过后合并到 main → CI 部署 → `python scripts/verify_deploy.py` → iPhone 真机验收。

## B. UI 后续（不依赖本机，可在云端做）

用户在 G4 之后又出了几版设计稿，都在 `output/ui-concepts/`（已随本分支提交）：

1. **去掉节目 / 单词 / 我的顶部大标题**：用户明确不要重复大标题。今日页已经是"声波 logo + 搜索"，不用改。
2. **播放视图按 H5**（`2026-09-28-player-v5/`）。用户认为现在的播放页太空。
   - 标题下加"当前句双语预览"卡：英文约 21px，中文约 14px。
   - 当前在读的词组下面画一条玫红同步线，右下角放展开图标，点击切到"文稿"。
   - 收紧标题、进度、控件、工具行之间的距离。
3. **单词页按 `2026-09-28-tabs-v6/words-tab.png`**。注意图里顶部进度条的比例是错的，要按真实数据画。
4. **我的页按 `2026-09-28-tabs-v6/me-tab.png`**：分组设置行 + 玫红线性图标 + chevron。
   - 每天新词 / 目标记忆率 / 外观 进二级选择。
   - 我的收藏、离线音频 进二级列表。
   - 学习记录保留"导出/导入"两个按钮。
   - "素材与版本信息"进二级页。
5. **节目页**：设计图没生成出来，按 `2026-09-28-tabs-v6/design-notes-and-prompts.md` 里"节目"一节的文字做：
   - 顶部搜索栏；
   - 频道胶囊：全部 / BBC / Curious / Thinking；
   - 收听状态筛选：下划线样式 + 右侧期数；
   - 行式列表，正在播放的那集用玫红小音柱标出。

## 已知坑（接手前先看）

- 本地开发数据只有冒烟 4 期；UI 效果以真机为准，改完按 iPhone 视口检查（`CLAUDE.md` 里的 iOS PWA 清单）。
- 字幕当前句用 `-webkit-text-stroke` 仿粗体，不改字重：换句时文字几何尺寸不变，列表不跳。不要改回 `font-weight`。
- 词级高亮与跟随滚动直接改 DOM class（`Player.tsx` 的 `syncWords`），不走 React 渲染。
- 本机内存吃紧时，整集送 whisper 会分配失败。`align.py` 已改成按停顿切约 4 分钟一段识别。
- Thinking in English 的 RSS 简介链接后面跟着不可见的 U+2060，URL 正则已限定为 ASCII；RSS 直连 feeds.megaphone.fm。
