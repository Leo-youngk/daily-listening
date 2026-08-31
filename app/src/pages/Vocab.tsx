import { useEffect, useMemo, useState } from 'react'
import { loadVocab, removeVocab, updateVocab } from '../lib/storage'
import type { VocabItem } from '../lib/types'
import { BookOpenIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { usePlayerActions } from '../store/PlayerContext'
import { navigate } from '../hooks/useHashRoute'
import { fmtTime } from '../lib/format'

const PAGE_SIZE = 30

function ReviewMode({ items, onExit }: { items: VocabItem[]; onExit: () => void }) {
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const item = items[idx]
  if (!item) return null

  const next = (known: boolean) => {
    if (known) updateVocab(item.id, { mastered: true })
    setFlipped(false)
    if (idx + 1 >= items.length) onExit()
    else setIdx(idx + 1)
  }

  return (
    <div className="flex h-full flex-col px-4 py-3">
      <div className="flex items-center justify-between">
        <button onClick={onExit} className="text-sm font-medium text-primary">‹ 退出复习</button>
        <span className="text-xs tabular-nums text-muted-foreground">{idx + 1} / {items.length}</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center">
        <div
          className="w-full rounded-xl bg-card p-6 text-center shadow-xs ring-1 ring-foreground/5"
          onClick={() => setFlipped(!flipped)}
        >
          <p className="text-3xl font-bold">{item.term}</p>
          {item.phonetic && !flipped && <p className="mt-2 text-sm text-muted-foreground">{item.phonetic}</p>}
          {!flipped ? (
            <p className="mt-6 text-xs text-muted-foreground">点击卡片查看释义</p>
          ) : (
            <div className="mt-4 text-left">
              <p className="text-sm leading-relaxed">{item.contextMeaning}</p>
              {item.explanation && (
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{item.explanation}</p>
              )}
              {item.sentenceEn && <p className="mt-2 text-xs italic text-muted-foreground">"{item.sentenceEn}"</p>}
            </div>
          )}
        </div>
        <div className="mt-6 flex w-full gap-3">
          <Button variant="secondary" onClick={() => next(false)} className="h-11 flex-1 rounded-xl">还不认识</Button>
          <Button onClick={() => next(true)} className="h-11 flex-1 rounded-xl">已掌握</Button>
        </div>
      </div>
    </div>
  )
}

export default function Vocab() {
  const [items, setItems] = useState<VocabItem[]>(loadVocab)
  const [review, setReview] = useState(false)
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const { playTalk } = usePlayerActions()

  const refresh = () => setItems(loadVocab())

  useEffect(() => {
    const onStorage = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail === 'dtl.vocab') refresh()
    }
    window.addEventListener('dtl-storage', onStorage)
    return () => window.removeEventListener('dtl-storage', onStorage)
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const kw = search.toLowerCase().trim()
    return items.filter(v =>
      v.term.toLowerCase().includes(kw) ||
      v.contextMeaning.toLowerCase().includes(kw) ||
      (v.word && v.word.toLowerCase().includes(kw)),
    )
  }, [items, search])

  const visible = filtered.slice(0, visibleCount)
  const hasMore = visible.length < filtered.length

  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [search])

  const jumpToSource = (v: VocabItem) => {
    if (!v.slug) return
    playTalk(v.slug, v.startTime ?? 0)
    navigate(`/talk/${v.slug}`)
  }

  if (review) {
    const pool = items.filter(v => !v.mastered)
    if (!pool.length) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <p className="text-sm">所有生词都已掌握 🎉</p>
          <Button onClick={() => setReview(false)} className="rounded-full px-4">返回</Button>
        </div>
      )
    }
    return <ReviewMode items={pool} onExit={() => { setReview(false); refresh() }} />
  }

  return (
    <div className="flex h-full flex-col px-3 pb-4">
      <div className="safe-top flex items-center justify-between pt-3 pb-2">
        <h1 className="text-xl font-bold">生词本</h1>
        {items.length > 0 && (
          <Button onClick={() => setReview(true)} className="rounded-full px-4">开始复习</Button>
        )}
      </div>

      {items.length > 0 && (
        <div className="relative mb-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索生词或释义"
            className="h-9 rounded-xl border-transparent bg-card pl-9 text-sm shadow-xs ring-1 ring-foreground/5"
          />
        </div>
      )}

      {items.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          <BookOpenIcon className="size-10" strokeWidth={1.5} />
          <p className="mt-3 text-sm">还没有生词</p>
          <p className="mt-1 text-xs">在播放页点击字幕中的单词即可查询并收藏</p>
        </div>
      )}

      <div className="space-y-2 overflow-y-auto no-scrollbar vertical-scroll">
        {visible.map(v => (
          <div key={v.id} className={`rounded-xl bg-card p-3 shadow-xs ring-1 ring-foreground/5 ${v.mastered ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-bold">{v.term}</p>
              {v.partOfSpeech && <span className="text-xs italic text-muted-foreground">{v.partOfSpeech}</span>}
              {v.phonetic && <p className="truncate text-xs text-muted-foreground">{v.phonetic}</p>}
              <span className="flex-1" />
              <Badge
                asChild
                variant={v.mastered ? 'secondary' : 'default'}
                className={`h-6 cursor-pointer rounded-full px-2.5 ${v.mastered ? 'text-muted-foreground' : ''}`}
              >
                <button onClick={() => { updateVocab(v.id, { mastered: !v.mastered }); refresh() }}>
                  {v.mastered ? '已掌握' : '标为掌握'}
                </button>
              </Badge>
              <Button
                variant="secondary"
                size="xs"
                className="rounded-full px-2.5 text-muted-foreground"
                onClick={() => { removeVocab(v.id); refresh() }}
              >
                删除
              </Button>
            </div>
            <p className="mt-1.5 text-[13px] leading-snug">{v.contextMeaning}</p>
            {v.term !== v.word && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">本句中出现为 {v.word}</p>
            )}
            {v.sentenceEn && (
              <button
                onClick={() => jumpToSource(v)}
                disabled={!v.slug}
                className="mt-1 w-full text-left text-[11px] italic leading-snug text-muted-foreground disabled:opacity-100"
              >
                <span className="line-clamp-2">"{v.sentenceEn}"</span>
                {v.slug && (
                  <span className="mt-0.5 inline-block not-italic text-primary">
                    回到原文 {v.startTime !== undefined ? fmtTime(v.startTime) : ''}
                  </span>
                )}
              </button>
            )}
          </div>
        ))}
        {filtered.length === 0 && items.length > 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的生词</p>
        )}
        {hasMore && (
          <Button
            variant="ghost"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
          >
            加载更多（{filtered.length - visible.length} 条剩余）
          </Button>
        )}
      </div>
    </div>
  )
}
