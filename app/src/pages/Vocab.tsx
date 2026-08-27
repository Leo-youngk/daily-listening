import { useEffect, useState } from 'react'
import { loadVocab, removeVocab, updateVocab } from '../lib/storage'
import type { VocabItem } from '../lib/types'
import { BookOpenIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

function ReviewMode({ items, onExit }: { items: VocabItem[]; onExit: () => void }) {
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const item = items[idx]
  if (!item) return null

  const next = (known: boolean) => {
    if (known) updateVocab(item.word, { mastered: true })
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
          <p className="text-3xl font-bold">{item.word}</p>
          {item.phonetic && !flipped && <p className="mt-2 text-sm text-muted-foreground">{item.phonetic}</p>}
          {!flipped ? (
            <p className="mt-6 text-xs text-muted-foreground">点击卡片查看释义</p>
          ) : (
            <div className="mt-4 text-left">
              {item.meaning && <p className="text-sm leading-relaxed">{item.meaning}</p>}
              {item.source && <p className="mt-2 text-xs italic text-muted-foreground">“{item.source}”</p>}
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
  const [items, setItems] = useState<VocabItem[]>([])
  const [review, setReview] = useState(false)
  const [, force] = useState(0)

  useEffect(() => { setItems(loadVocab()) }, [])

  const refresh = () => { setItems(loadVocab()); force(x => x + 1) }

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

      {items.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          <BookOpenIcon className="size-10" strokeWidth={1.5} />
          <p className="mt-3 text-sm">还没有生词</p>
          <p className="mt-1 text-xs">在播放页点击字幕中的单词即可查询并收藏</p>
        </div>
      )}

      <div className="space-y-2 overflow-y-auto no-scrollbar">
        {items.map(v => (
          <div key={v.word} className={`rounded-xl bg-card p-3 shadow-xs ring-1 ring-foreground/5 ${v.mastered ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-bold">{v.word}</p>
              {v.phonetic && <p className="text-xs text-muted-foreground">{v.phonetic}</p>}
              <span className="flex-1" />
              <Badge
                asChild
                variant={v.mastered ? 'secondary' : 'default'}
                className={`h-6 cursor-pointer rounded-full px-2.5 ${v.mastered ? 'text-muted-foreground' : ''}`}
              >
                <button onClick={() => { updateVocab(v.word, { mastered: !v.mastered }); refresh() }}>
                  {v.mastered ? '已掌握' : '标为掌握'}
                </button>
              </Badge>
              <Button
                variant="secondary"
                size="xs"
                className="rounded-full px-2.5 text-muted-foreground"
                onClick={() => { removeVocab(v.word); refresh() }}
              >
                删除
              </Button>
            </div>
            {v.meaning && <p className="mt-1.5 text-[13px] leading-snug">{v.meaning}</p>}
            {v.source && <p className="mt-1 truncate text-[11px] italic text-muted-foreground">“{v.source}”</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
