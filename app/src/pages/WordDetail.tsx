import { useEffect, useState } from 'react'
import { ChevronLeftIcon, PlayIcon, Volume2Icon } from 'lucide-react'
import { navigate } from '../hooks/useHashRoute'
import { useCards } from '../hooks/useCards'
import { useCatalog, usePlayerActions } from '../store/PlayerContext'
import { addToReview, formatInterval, isMastered, markKnown, relearn, removeCard } from '../lib/srs'
import { clipUrl, examplesFor, loadWordbookMap } from '../lib/wordbook'
import type { BookWord, CardExample } from '../lib/wordbook'
import { playClip, prefetchClip, speakWord, stopClip } from '../lib/clips'
import { seriesInfo } from '../lib/types'
import { HighlightedSentence } from '../components/ExampleSentence'

export default function WordDetail({ term }: { term: string }) {
  const { cards } = useCards()
  const { manifest } = useCatalog()
  const { playTalk } = usePlayerActions()
  const card = cards.get(term)
  const [entry, setEntry] = useState<BookWord | undefined>()
  const [examples, setExamples] = useState<CardExample[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => {
    loadWordbookMap().then(map => setEntry(map.get(term))).catch(() => setEntry(undefined))
  }, [term])

  useEffect(() => {
    let alive = true
    examplesFor(term, card?.contexts).then(async list => {
      if (!alive) return
      setExamples(list)
      const pairs = await Promise.all(list.map(async ex => [`${ex.slug}/${ex.i}`, await clipUrl(ex.slug, ex.i, ex.start)] as const))
      if (!alive) return
      setUrls(Object.fromEntries(pairs))
      for (const [, url] of pairs.slice(0, 2)) void prefetchClip(url)
    }).catch(() => { if (alive) setExamples([]) })
    return () => { alive = false; stopClip() }
  }, [term, card?.contexts])

  const meaning = card?.meaning || entry?.zh || ''
  const phonetic = card?.phonetic || entry?.ph || ''
  const input = { term, kind: term.includes(' ') ? 'phrase' as const : 'word' as const, inBook: !!entry, meaning, phonetic }
  const now = Date.now()
  const status = !card ? '还没学' : card.status === 'known' ? '已标熟，不再安排复习'
    : isMastered(card) ? `已掌握 · ${formatInterval(card.due - now)}后复习`
      : card.due <= now ? '学习中 · 现在该复习了' : `学习中 · ${formatInterval(card.due - now)}后复习`
  const legacy = (card?.contexts ?? []).filter(c => !c.slug)

  const play = (ex: CardExample) => {
    const url = urls[`${ex.slug}/${ex.i}`]
    if (!url) return
    const key = `${ex.slug}/${ex.i}`
    setPlaying(key)
    playClip(url, () => setPlaying(null)).catch(() => setPlaying(null))
  }

  return (
    <div className="word-page">
      <header className="word-header safe-top">
        <button onClick={() => (history.length > 1 ? history.back() : navigate('/words'))} aria-label="返回" className="review-back">
          <ChevronLeftIcon />
        </button>
      </header>
      <main className="word-main overflow-y-auto vertical-scroll">
        <div className="review-word-row">
          <h1 className="review-word">{term}</h1>
          <button className="review-speak" onClick={() => speakWord(term)} aria-label="单词发音"><Volume2Icon /></button>
        </div>
        <p className="review-phonetic">
          {phonetic && `/${phonetic}/`}
          {entry && <span className="review-tag">{entry.tier === 6 ? '六级新词' : '六级词表'}</span>}
        </p>
        <p className="word-meaning">{meaning || '（暂无释义）'}</p>
        <p className="word-status">{status}</p>

        <div className="word-actions">
          {!card && <button className="pill-button is-small" onClick={() => addToReview(input)}>加入复习</button>}
          {!card && <button className="pill-button is-soft is-small" onClick={() => markKnown(input)}>我认识，标熟</button>}
          {card?.status === 'learning' && <button className="pill-button is-soft is-small" onClick={() => markKnown(input)}>标熟</button>}
          {card && <button className="pill-button is-soft is-small" onClick={() => relearn(term)}>重新学</button>}
          {card && !card.inBook && <button className="pill-button is-soft is-small" onClick={() => removeCard(term)}>移出</button>}
        </div>

        <h2 className="word-section">原声例句</h2>
        {examples === null && <p className="word-hint">加载中…</p>}
        {examples?.length === 0 && <p className="word-hint">收录的节目里还没有出现过这个词</p>}
        <ul className="word-examples">
          {examples?.map(ex => {
            const meta = manifest.find(m => m.slug === ex.slug)
            const key = `${ex.slug}/${ex.i}`
            return (
              <li key={key} className="word-example">
                <button className={`review-play ${playing === key ? 'is-playing' : ''}`} onClick={() => play(ex)} aria-label="播放原声">
                  <PlayIcon />
                </button>
                <div>
                  <p lang="en" className="word-example-en"><HighlightedSentence text={ex.en} w={ex.w} term={term} /></p>
                  {ex.zh && <p className="word-example-zh">{ex.zh}</p>}
                  {meta && (
                    <button className="word-source" onClick={() => { playTalk(ex.slug, ex.start); navigate(`/talk/${ex.slug}`) }}>
                      {ex.own ? '我遇到的 · ' : ''}{seriesInfo(meta.category).name} · {meta.title}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {legacy.length > 0 && (
          <>
            <h2 className="word-section">旧生词本里的原句</h2>
            {legacy.map((c, k) => (
              <p key={k} className="word-legacy">{c.en}</p>
            ))}
          </>
        )}
      </main>
    </div>
  )
}
