# 待办交接

"听 + 背六级单词"重构已完成全量数据并合并 main（2026-09-28）。

## 当前数据

| 项目 | 状态 |
| --- | --- |
| 节目 | BBC 6 Minute English 100 · Curious Minds 50 · Thinking in English 50（清单见 `scripts/corpus/episodes.json`） |
| 中文翻译 | 200/200，每期用的模型记在数据的 `zhModel`。免费层高峰期好模型额度用完或持续 503，大部分是 `gemini-3.5-flash-lite` 翻的；有 14 期 Gemini 原样照抄了英文，改由 Claude Sonnet 5 子 agent 补翻（`zhModel: claude-sonnet-5`） |
| R2 | 整集音频（高/标准两档）+ 全部逐句原声切片 |

整集音频（`public/audio`）和对齐结果（`public/subs`）按 .gitignore 不进仓库，只在原来那台电脑上。

## 可选的后续

1. **用好模型重翻 flash-lite 的期**：删掉对应的 `scripts/corpus/zh/<slug>.json` 缓存，在额度充足的时段（太平洋时间 0 点后）跑
   `python build_talks.py --translate-only --workers 2`，再依次跑 `build_talks.py` → `align_words.py` → `build_vocab.py`，改动的句子起点不变，不用重切原声。
2. **首播速度**：改版前本机实测 BBC 约 4.5 秒、Curious 约 19 秒（到 workers.dev 的 TLS 握手 0.7~3.8 秒 + 长节目 moov 索引 244~304KB）。已做三件事：
   - 音频同源（`app/functions/audio` 读 R2），不再单独握手；
   - 标准音质改 MP3，没有 moov 索引；
   - 启动时预挂上次没听完的那集 / 今日主推（`primeTalk`），点播放时开头已经下好。
   待 iPhone 真机实测。旧的 workers.dev 音频网关和 R2 里旧的标准音质 m4a 已经用户同意删除（2026-09-29）。
3. iPhone 真机验收：safe-area、橡皮筋、横滑、双指缩放（见 `CLAUDE.md` 的 iOS PWA 清单）。

## 已知坑（接手前先看）

- 字幕当前句用 `-webkit-text-stroke` 仿粗体，不改字重：换句时文字几何尺寸不变，列表不跳。不要改回 `font-weight`。
- 词级高亮、跟随滚动、播放页预览卡的同步线都直接改 DOM class（`Player.tsx` 的 `syncWords` / `syncPreview`），不走 React 渲染。
- 预览卡是固定高度（长句自动换小一号字），换句不让下面的控件跳；英文段落的下内边距是给同步线留的，line-clamp 的 overflow 会裁掉超出的线。
- 本机内存吃紧时，整集送 whisper 会分配失败。`align.py` 按停顿切约 4 分钟一段识别。
- Thinking in English 的 RSS 简介链接后面跟着不可见的 U+2060，URL 正则已限定为 ASCII；RSS 直连 feeds.megaphone.fm。部分老期的博客正文已 404，`ingest.py` 会自动顺延取下一期。
