import { useMemo, useState } from 'react'
import { usePlayer } from '../store/PlayerContext'
import { loadProgress } from '../lib/storage'
import { navigate } from '../hooks/useHashRoute'
import { fmtTime } from '../lib/format'
import { ChevronRightIcon, PlayIcon, SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import TalkCard from '../components/TalkCard'
import Cover from '../components/Cover'

/** 每日一句：按日期固定取一句，避免刷新后变化 */
function useDailyQuote(manifest: { slug: string }[]) {
  return useMemo(() => {
    if (manifest.length === 0) return null
    const dayKey = new Date().toISOString().slice(0, 10)
    let seed = 0
    for (const c of dayKey) seed = (seed * 31 + c.charCodeAt(0)) >>> 0
    return { talkIdx: seed % manifest.length, seed }
  }, [manifest])
}

export default function Discover() {
  const { manifest, manifestReady, playTalk } = usePlayer()
  const [quote, setQuote] = useState<{ en: string; zh: string; title: string; slug: string; at: number } | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const daily = useDailyQuote(manifest)

  const dateStr = useMemo(() => {
    const d = new Date()
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }, [])

  // 继续学习
  const lastPlayed = useMemo(() => {
    const prog = loadProgress()
    const entries = Object.entries(prog).filter(([, v]) => v.pos > 3 && v.pos < v.duration - 15)
    if (!entries.length) return null
    entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    const [slug, v] = entries[0]
    const meta = manifest.find(m => m.slug === slug)
    return meta ? { meta, pos: v.pos } : null
  }, [manifest])

  // 加载每日一句（懒加载该篇字幕，随机挑一句有中文的）
  useMemo(() => {
    if (!daily) return
    const meta = manifest[daily.talkIdx]
    if (!meta || quote) return
    setQuoteLoading(true)
    fetch(`data/${meta.slug}.json`)
      .then(r => r.json())
      .then(data => {
        const cands = data.sentences.filter((s: { en: string; zh: string }) => s.en.length > 40 && s.en.length < 160 && s.zh)
        if (cands.length) {
          const s = cands[daily.seed % cands.length]
          setQuote({ en: s.en, zh: s.zh, title: meta.title, slug: meta.slug, at: s.start })
        }
      })
      .catch(() => {})
      .finally(() => setQuoteLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily?.talkIdx])

  if (!manifestReady) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
  }

  const recs = manifest.slice(0, 6)

  return (
    <div className="px-3 pb-4">
      <header className="safe-top pt-4 pb-3">
        <p className="text-[13px] text-muted-foreground">{dateStr}</p>
        <h1 className="text-xl font-bold">今天也要磨耳朵</h1>
      </header>

      {/* 每日一句 */}
      <section
        className="relative overflow-hidden rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/5"
        onClick={() => {
          if (!quote) return
          playTalk(quote.slug, quote.at)
          navigate(`/talk/${quote.slug}`)
        }}
      >
        <div className="absolute -right-4 -top-6 text-[72px] leading-none text-primary/10 select-none">“</div>
        <p className="flex items-center gap-1 text-xs font-semibold text-primary">
          <SparklesIcon className="size-3.5" />每日一句
        </p>
        {quoteLoading && <p className="mt-3 text-sm text-muted-foreground">正在挑选今日金句…</p>}
        {quote && (
          <div className="mt-2 block text-left">
            <p className="text-[15px] font-medium leading-relaxed">{quote.en}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{quote.zh}</p>
            <p className="mt-2 text-[11px] text-primary">—— {quote.title} · 点击听这句</p>
          </div>
        )}
      </section>

      {/* 继续学习 */}
      {lastPlayed && (
        <section
          className="mt-3 flex items-center gap-3 rounded-xl bg-card p-3 shadow-xs ring-1 ring-foreground/5"
          onClick={() => playTalk(lastPlayed.meta.slug, lastPlayed.pos)}
        >
          {lastPlayed.meta.cover ? (
            <Cover src={lastPlayed.meta.cover} className="h-12 w-12 rounded-lg object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">♪</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary">继续学习</p>
            <p className="truncate text-sm font-medium">{lastPlayed.meta.title}</p>
            <p className="text-[11px] text-muted-foreground">上次听到 {fmtTime(lastPlayed.pos)}</p>
          </div>
          <Button size="icon" className="size-9 shrink-0 rounded-full">
            <PlayIcon className="fill-current" />
          </Button>
        </section>
      )}

      {/* 精选推荐 */}
      <section className="mt-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[15px] font-bold">精选推荐</h2>
          <button onClick={() => navigate('/library')} className="flex items-center text-xs font-medium text-primary">
            全部<ChevronRightIcon className="size-3.5" />
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
          {recs.map(m => (
            <button
              key={m.slug}
              onClick={() => navigate(`/talk/${m.slug}`)}
              className="w-36 shrink-0 overflow-hidden rounded-xl bg-card text-left shadow-xs ring-1 ring-foreground/5 transition active:scale-[0.98]"
            >
              {m.cover ? (
                <Cover src={m.cover} className="h-20 w-full object-cover" />
              ) : (
                <div className="flex h-20 w-full items-center justify-center bg-primary/10 text-sm font-bold text-primary">TED</div>
              )}
              <div className="p-2.5">
                <p className="line-clamp-2 text-[12px] font-medium leading-snug">{m.title}</p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">{m.speaker}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 最新入库 */}
      <section className="mt-4">
        <h2 className="mb-2 text-[15px] font-bold">毕业演讲精选</h2>
        <div className="space-y-2">
          {manifest.filter(m => m.category === 'commencement').slice(0, 5).map(item => (
            <TalkCard key={item.slug} item={item} showProgress={false} />
          ))}
        </div>
      </section>
    </div>
  )
}
