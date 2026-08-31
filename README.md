# 每日听力 · TED 版（每日英语听力复刻）

面向 iOS 的 PWA 英语精听应用，复刻「每日英语听力」的核心体验：
**逐句双语字幕同步滚动、词级高亮跟随、单句循环、点词查词、生词本、收藏与打卡进度**。

素材：100 篇最著名 TED 演讲（按播放量选取）+ 100 篇名校毕业演讲。
音频来自 YouTube（TED 官方频道优先），英文字幕为官方/自动生成字幕，
中文优先用官方中文字幕，缺失时用机器翻译（界面会标注「机译」）。

## 目录结构

```
├── app/                  # 前端（Vite + React + TS + Tailwind + PWA）
├── scripts/              # 抓取管线（Python）
│   ├── corpus/           # 语料清单、匹配结果、抓取状态、翻译缓存
│   ├── resolve.py        # 把清单匹配成 YouTube 视频
│   ├── audit_duration.py # 音源/文字稿匹配审计（时长校验、排除 TED-Ed 摘要版）
│   ├── fetch.py          # 下载音频 + json3 字幕（断点续抓）
│   ├── vtt2json.py       # 字幕转逐句双语 JSON + 机译 + 生成 manifest（内置时长一致性校验）
│   ├── fill_covers.py    # 补齐封面缩略图
│   └── sync_dist.py      # 构建后把素材同步到 dist
└── public/
    ├── audio/            # m4a 音频
    ├── data/             # manifest.json + 每篇逐句双语 JSON
    └── icons/            # PWA 图标
```

## 日常使用

```powershell
cd app
npm run dev        # 开发模式，素材直接从 ../public 提供
```

iPhone 使用：把站点部署（或局域网开放）后，用 Safari 打开 →
「分享 → 添加到主屏幕」，即可像原生 App 一样全屏使用，听过的内容会离线缓存。

## 生产构建

```powershell
cd app; npm run build          # 产物在 app/dist（不含素材）
python ../scripts/sync_dist.py # 把 data/icons/covers/dict 同步进 dist
```

## 素材管线（一次性，已全部跑完；增量补抓时参考）

```powershell
cd scripts
python resolve.py              # 清单 → YouTube 视频匹配（输出 corpus/resolved.json）
python audit_duration.py       # 时长审计：防止音源与文字稿错配（TED-Ed 摘要版会被替换）
python fetch.py                # 下载音频+字幕，断点续抓；--category ted|commencement，--limit N
python vtt2json.py             # 生成逐句双语 JSON 与 manifest（内置音源/字幕一致性校验，错配自动跳过）
python fill_covers.py          # 补封面
```

## 已知限制

- iOS Safari 锁屏后台播放支持有限（系统限制）；应用内切页不影响播放。
- 毕业演讲的中文为机器翻译，仅供理解参考。
- 素材仅用于个人学习。
