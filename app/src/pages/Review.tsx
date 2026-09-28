import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, PlayIcon, Volume2Icon } from 'lucide-react'
import { navigate } from '../hooks/useHashRoute'
import { usePlayer } from '../store/PlayerContext'
import { db } from '../lib/db'
import type { CardRecord } from '../lib/db'
import {
  addToReview, dueCards, formatInterval, GRADES, introducedToday, LEARN_AHEAD_MS, markKnown,
  previewDue, rate, Rating,
} from '../lib/srs'
import type { Grade } from '../lib/srs'
import { clipUrl, examplesFor, loadWordbook, loadWordbookMap } from '../lib/wordbook'
import type { BookWord, CardExample } from '../lib/wordbook'
import { playClip, prefetchClip, speakWord, stopClip } from '../lib/clips'
import { loadSettings, recordStudy } from '../lib/storage'
import { HighlightedSentence } from '../components/ExampleSentence'

type Item = { kind: 'review' | 'new'; term: string }
type Phase = 'loading' | 'intro' | 'front' | 'back' | 'learn' | 'done' | 'empty'
interface Prepared {
  example?: CardExample
  url?: string
}

const GRADE_LABEL: Record<number, string> = {
  [Rating.Again]: '忘了',
  [Rating.Hard]: '模糊',
  [Rating.Good]: '记得',
  [Rating.Easy]: '简单',
}

/**
 * 一轮背词：先复习到期的卡，再学今天的新词。
 * 新词：认识就标熟跳过；不认识就看一遍释义和原声，10 分钟后在本轮末尾再考一次。
 * 所有卡片正面自动播放一句真人原声（点击回调里同步起播，满足 iOS 手势限制）。
 */
export default function Review() {
  const player = usePlayer()
  const [queue, setQueue] = useState<Item[]>([])
  const [pos, setPos] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [card, setCard] = useState<CardRecord | null>(null)
  const [book, setBook] = useState<Map<string, BookWord>>(new Map())
  const [current, setCurrent] = useState<Prepared>({})
  const [playing, setPlaying] = useState(false)
  const [done, setDone] = useState({ reviewed: 0, learned: 0, known: 0 })
  const [error, setError] = useState<string | null>(null)
  const prepared = useRef(new Map<string, Prepared>())
  const pendingWrites = useRef(new Map<string, Promise<CardRecord | undefined>>())
  const counts = useRef({ due: 0, fresh: 0 })

  const prepare = useCallback(async (term: string, record?: CardRecord): Promise<Prepared> => {
    const hit = prepared.current.get(term)
    if (hit) return hit
    const examples = await examplesFor(term, record?.contexts)
    // 每次复习换一条例句：按复习次数轮换
    const example = examples.length ? examples[(record?.reps ?? 0) % examples.length] : undefined
    const url = example ? await clipUrl(example.slug, example.i, example.start) : undefined
    if (url) void prefetchClip(url)
    const value = { example, url }
    prepared.current.set(term, value)
    return value
  }, [])

  // 组队：到期复习 + 今日新词额度
  useEffect(() => {
    player.pause()
    let alive = true
    Promise.all([dueCards(), loadWordbook(), loadWordbookMap(), introducedToday(), db.cards.toArray()])
      .then(async ([due, words, map, started, all]) => {
        const taken = new Set(all.map(c => c.term))
        const quota = Math.max(0, loadSettings().dailyNew - started)
        const fresh = words.filter(w => !taken.has(w.word)).slice(0, quota)
        const items: Item[] = [
          ...due.map(c => ({ kind: 'review' as const, term: c.term })),
          ...fresh.map(w => ({ kind: 'new' as const, term: w.word })),
        ]
        counts.current = { due: due.length, fresh: fresh.length }
        if (!alive) return
        setBook(map)
        setQueue(items)
        if (!items.length) {
          setPhase('empty')
          return
        }
        // 先把前几张卡的例句与音频准备好，"开始"按下时能立刻出声
        const byTerm = new Map(due.map(c => [c.term, c]))
        await Promise.all(items.slice(0, 3).map(item => prepare(item.term, byTerm.get(item.term))))
        if (alive) setPhase('intro')
      })
      .catch(loadError => {
        console.error('review queue failed', loadError)
        if (alive) setError('加载失败，请检查网络后重试')
      })
    return () => {
      alive = false
      stopClip()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const item = queue[pos]

  // 当前卡片的数据库记录与例句；顺手准备后面两张
  useEffect(() => {
    if (!item) return
    let alive = true
    const pending = pendingWrites.current.get(item.term)
    Promise.resolve(pending ?? db.cards.get(item.term)).then(async record => {
      if (!alive) return
      setCard(record ?? null)
      const value = await prepare(item.term, record ?? undefined)
      if (alive) setCurrent(value)
    }).catch(loadError => console.error('load card failed', loadError))
    for (const next of queue.slice(pos + 1, pos + 3)) {
      void db.cards.get(next.term).then(record => prepare(next.term, record ?? undefined))
    }
    return () => { alive = false }
  }, [item, pos, queue, prepare])

  const play = useCallback((url?: string) => {
    if (!url) return
    setPlaying(true)
    playClip(url, () => setPlaying(false)).catch(() => setPlaying(false))
  }, [])

  /** 切到下一张：必须在点击回调里同步调用，才能直接起播下一张的原声 */
  const advance = (nextQueue: Item[]) => {
    stopClip()
    setPlaying(false)
    const nextPos = pos + 1
    setQueue(nextQueue)
    setPos(nextPos)
    const next = nextQueue[nextPos]
    if (!next) {
      setPhase('done')
      return
    }
    setPhase('front')
    const ready = prepared.current.get(next.term)
    setCurrent(ready ?? {})
    setCard(null)
    play(ready?.url)
  }

  const start = () => {
    setPhase('front')
    play(current.url ?? prepared.current.get(queue[0]?.term)?.url)
  }

  const bookWord = item ? book.get(item.term) : undefined
  const meaning = card?.meaning || bookWord?.zh || ''
  const phonetic = card?.phonetic || bookWord?.ph || ''

  const onKnown = () => {
    if (!item) return
    advance(queue)
    setDone(d => ({ ...d, known: d.known + 1 }))
    void markKnown({ term: item.term, kind: 'word', inBook: true, meaning, phonetic })
    recordStudy()
  }

  const onLearned = () => {
    if (!item) return
    // 新词学完按"记得"入队：约 10 分钟后在本轮末尾再考一次
    const requeued = [...queue, { kind: 'review' as const, term: item.term }]
    advance(requeued)
    setDone(d => ({ ...d, learned: d.learned + 1 }))
    const write = addToReview({ term: item.term, kind: 'word', inBook: true, meaning, phonetic })
      .then(() => rate(item.term, Rating.Good))
    pendingWrites.current.set(item.term, write)
    write.catch(writeError => setError(`保存失败：${writeError instanceof Error ? writeError.message : writeError}`))
      .finally(() => pendingWrites.current.delete(item.term))
    recordStudy()
  }

  const onRate = (grade: Grade) => {
    if (!item || !card) return
    const due = previewDue(card)[grade]
    const again = due - Date.now() < LEARN_AHEAD_MS
    advance(again ? [...queue, { kind: 'review', term: item.term }] : queue)
    setDone(d => ({ ...d, reviewed: d.reviewed + 1 }))
    const write = rate(item.term, grade)
    pendingWrites.current.set(item.term, write)
    write.catch(writeError => setError(`保存失败：${writeError instanceof Error ? writeError.message : writeError}`))
      .finally(() => pendingWrites.current.delete(item.term))
    recordStudy()
  }

  const intervals = card && phase === 'back' ? previewDue(card) : null
  const progress = queue.length ? Math.min(100, (pos / queue.length) * 100) : 0
  const example = current.example

  return (
    <div className="review-page">
      <header className="review-header safe-top">
        <button onClick={() => (history.length > 1 ? history.back() : navigate('/'))} aria-label="返回" className="review-back">
          <ChevronLeftIcon />
        </button>
        <div className="review-progress" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="review-count">{Math.min(pos + 1, queue.length)}/{queue.length}</span>
      </header>

      {error && <p role="alert" className="review-error">{error}</p>}

      {phase === 'loading' && !error && <p className="review-status">正在准备今天的单词…</p>}

      {phase === 'empty' && (
        <div className="review-center">
          <p className="review-big">今天的单词都背完了</p>
          <p className="review-sub">没有到期的复习，今日新词额度也已用完。去听一集节目，巩固刚学的词。</p>
          <button className="pill-button is-large" onClick={() => navigate('/programs')}>去听节目</button>
        </div>
      )}

      {phase === 'intro' && (
        <div className="review-center">
          <p className="review-big">今天：复习 {counts.current.due} · 新词 {counts.current.fresh}</p>
          <p className="review-sub">每张卡都会先放一句节目里的真人原声，戴上耳机效果更好。</p>
          <button className="pill-button is-large" onClick={start}>开始</button>
        </div>
      )}

      {item && (phase === 'front' || phase === 'back' || phase === 'learn') && (
        <main className="review-card overflow-y-auto vertical-scroll">
          <div className="review-word-row">
            <h1 className="review-word">{item.term}</h1>
            <button className="review-speak" onClick={() => speakWord(item.term)} aria-label="单词发音">
              <Volume2Icon />
            </button>
          </div>
          <p className="review-phonetic">
            {phonetic && `/${phonetic}/`}
            {item.kind === 'new' && <span className="review-tag">{bookWord?.tier === 6 ? '六级新词' : '六级词表'}</span>}
          </p>

          {example ? (
            <button className="review-example" onClick={() => play(current.url)}>
              <span className={`review-play ${playing ? 'is-playing' : ''}`}><PlayIcon /></span>
              <span lang="en" className="review-example-en">
                <HighlightedSentence text={example.en} w={example.w} term={item.term} />
              </span>
            </button>
          ) : (
            <p className="review-no-clip">这个词在已收录的节目里还没有出现过，暂无原声例句</p>
          )}

          {(phase === 'back' || phase === 'learn') && (
            <div className="review-answer">
              <p className="review-meaning">{meaning || '（暂无释义）'}</p>
              {example?.zh && <p className="review-example-zh">{example.zh}</p>}
              <button className="review-link" onClick={() => navigate(`/word/${encodeURIComponent(item.term)}`)}>
                查看全部例句
              </button>
            </div>
          )}
        </main>
      )}

      {item && phase === 'front' && (
        <footer className="review-actions safe-bottom">
          {item.kind === 'new' ? (
            <div className="review-buttons two">
              <button className="pill-button is-soft is-large" onClick={onKnown}>认识，跳过</button>
              <button className="pill-button is-large" onClick={() => setPhase('learn')}>不认识</button>
            </div>
          ) : (
            <button className="pill-button is-large is-wide" onClick={() => setPhase('back')}>显示释义</button>
          )}
        </footer>
      )}

      {item && phase === 'learn' && (
        <footer className="review-actions safe-bottom">
          <button className="pill-button is-large is-wide" onClick={onLearned}>记住了，下一个</button>
        </footer>
      )}

      {item && phase === 'back' && (
        <footer className="review-actions safe-bottom">
          <div className="review-buttons four">
            {GRADES.map(grade => (
              <button key={grade} className={`review-grade grade-${grade}`} onClick={() => onRate(grade)} disabled={!card}>
                <span>{GRADE_LABEL[grade]}</span>
                <small>{intervals ? formatInterval(intervals[grade] - Date.now()) : ''}</small>
              </button>
            ))}
          </div>
        </footer>
      )}

      {phase === 'done' && (
        <div className="review-center">
          <p className="review-big">这一轮完成了</p>
          <p className="review-sub">
            复习 {done.reviewed} 次 · 新学 {done.learned} 个 · 标熟 {done.known} 个
          </p>
          <div className="review-buttons two">
            <button className="pill-button is-soft is-large" onClick={() => navigate('/')}>回到今日</button>
            <button className="pill-button is-large" onClick={() => navigate('/programs')}>去听节目</button>
          </div>
        </div>
      )}
    </div>
  )
}
