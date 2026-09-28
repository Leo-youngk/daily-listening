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
| 前端 | 按设计稿 G4（`output/ui-concepts/2026-09-28-content-v4/`）重做完成：今日 / 节目 / 单词 / 我的 / 播放（播放·文稿两视图）/ 搜索 / 背词 / 查词 / 各面板；B 部分（H5 播放页、tabs-v6 三个 Tab）已在云端完成；typecheck、build 通过，测试 66/67（见下方 A4） |

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

## B. UI 后续（已完成，2026-09-28 云端）

1. ✅ 节目 / 单词 / 我的去掉顶部大标题（`.page.is-bare`），今日页不变。
2. ✅ 播放视图按 H5：标题下"当前句双语预览"卡（英文 21px / 中文 14px），当前词和前两个词下面画玫红同步线，右下角展开图标，点卡片切到"文稿"；标题、进度、主控、工具行间距收紧。
   - 卡片高度固定 172px（英文最多 3 行 + 中文 2 行），换句时下面的控件不跳；句子超过 3 行时卡内跟着念到的行滚动。
   - 同步线和字幕流一样由 rAF 直接改 DOM class（`Player.tsx` 的 `syncPreview`），不走 React 渲染。
3. ✅ 单词页按 `tabs-v6/words-tab.png`：已掌握 / 学习中 / 未学统计 + 按真实比例的双色进度条 + "复习 N"（没有待复习时是"学新词 N"）+ 页内搜索 + 下划线分组 + 带 chevron 的词行。
4. ✅ 我的页按 `tabs-v6/me-tab.png`：分组设置行 + 玫红线性图标 + chevron；每天新词 / 目标记忆率 / 外观、我的收藏、离线音频、素材与版本信息都进二级页（路由 `#/me/<section>`）；学习记录保留导出 / 导入按钮。
5. ✅ 节目页按设计说明：顶部页内搜索、频道胶囊（全部 / BBC / Curious / Thinking，默认"全部"，按日期倒序）、下划线收听状态筛选 + 右侧期数、行式列表，正在播放的那集有玫红小音柱和进度线。

以上只在桌面 Chromium 的 393×852 视口下验证过（含深色模式、超长句滚动），**还需要 iPhone 真机看一遍**。

## 已知坑（接手前先看）

- 本地开发数据只有冒烟 4 期；UI 效果以真机为准，改完按 iPhone 视口检查（`CLAUDE.md` 里的 iOS PWA 清单）。
- 字幕当前句用 `-webkit-text-stroke` 仿粗体，不改字重：换句时文字几何尺寸不变，列表不跳。不要改回 `font-weight`。
- 词级高亮与跟随滚动直接改 DOM class（`Player.tsx` 的 `syncWords`），不走 React 渲染。
- 本机内存吃紧时，整集送 whisper 会分配失败。`align.py` 已改成按停顿切约 4 分钟一段识别。
- Thinking in English 的 RSS 简介链接后面跟着不可见的 U+2060，URL 正则已限定为 ASCII；RSS 直连 feeds.megaphone.fm。
