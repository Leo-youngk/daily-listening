# 每日听力

面向 iPhone 的 PWA：**听英语学习播客 + 背六级单词**，两件事做成一个循环：

- **背的时候在听**：每个六级词都用节目里的一句真人原声来背（FSRS 间隔重复，Anki 同款算法）。
- **听的时候在背**：字幕里高亮你正在学的词、虚线标出没学过的六级新词；点词看本句义，一键加入复习。
- **听完的时候在背**：「本集词汇」列出节目官方重点词和本集的六级词，一次勾完"认识/不认识"。

## 节目

按大众口碑与六级适配度挑的三档，均有免费官方全文稿：

| 节目 | 期数 | 单集 | 语速 | 特点 |
|---|---|---|---|---|
| BBC 6 Minute English | 100 | 6 分钟 | ~151 wpm（六级听力 140–160） | 双人对话，每期官方重点词 6 个 |
| English Learning for Curious Minds | 50 | ~22 分钟 | ~125 wpm | 历史、科学、人物故事 |
| Thinking in English | 50 | ~25 分钟 | ~125 wpm | 时事、社会、文化；每期官方词表 |

中文字幕为 Gemini 机器翻译（界面有标注）。素材仅用于个人学习。

## 目录结构

```
├── app/                  # 前端（Vite + React + TS + Tailwind + PWA），Cloudflare Pages
│   ├── functions/api/    # 点词查本句义（Workers AI）
│   └── src/
│       ├── lib/srs.ts    # FSRS 调度（ts-fsrs）
│       ├── lib/db.ts     # 卡片与复习日志（IndexedDB / Dexie）
│       └── pages/        # 今日 / 节目 / 单词 / 复习 / 播放 / 我的
├── media-worker/         # R2 音频网关：整集音频 + 切句原声
├── scripts/              # 数据管线（Python），见 scripts/README.md
└── public/
    ├── data/             # manifest.json + 每集逐句双语 JSON（含词级时间轴）
    ├── wordbook/         # 六级词表、每集六级词索引
    ├── examples/         # 每个六级词的原声例句索引
    ├── dict/             # 本语料精简离线词典（ECDICT）
    └── covers/           # 封面
```

音频（`public/audio`）与切句原声不进仓库，存 Cloudflare R2，经 `media-worker` 提供。

## 开发

```powershell
cd app
npm run dev        # 素材直接从 ../public 提供
npm test           # 含 FSRS / IndexedDB（fake-indexeddb）测试
```

## 部署

推到 `main` 由 GitHub Actions 校验数据、类型检查、测试、构建并部署到 Cloudflare Pages，之后跑线上验收
（`scripts/verify_deploy.py`）。媒体网关单独部署：`cd media-worker; wrangler deploy`。

## 数据安全

学习记录（单词卡片、复习日志）只存在本机 IndexedDB。换手机或删除主屏 App 前，在「我的 → 学习记录」导出备份。

词典与六级词表基于 ECDICT（MIT License）。
