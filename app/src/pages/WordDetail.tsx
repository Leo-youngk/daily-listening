import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon, Volume2Icon } from 'lucide-react'
import { goBack, navigate } from '../hooks/useHashRoute'
import { useCards } from '../hooks/useCards'
import { useCatalog, usePlayerActions } from '../store/PlayerContext'
import { addToReview, formatInterval, isMastered, markKnown, relearn, removeCard } from '../lib/srs'
import { clipUrl, examplesFor, loadExamples, loadWordbookMap } from '../lib/wordbook'
import type { BookWord, CardExample } from '../lib/wordbook'
import { playClip, prefetchClip, speakWord, stopWordAudio } from '../lib/clips'
import { getWordBrowse } from '../lib/word-browse'
import { showName } from '../lib/types'
import { HighlightedSentence } from '../components/ExampleSentence'

export default function WordDetail({ term, browseId }: { term: string; browseId?: string }) {
  const { cards } = useCards()
  const { manifest } = useCatalog()
  const { playTalk } = usePlayerActions()
  const card = cards.get(term)
  const [entry, setEntry] = useState<BookWord | undefined>()
  const [examples, setExamples] = useState<CardExample[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [playing, setPlaying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const playback = useRef(0)
  const browse = useMemo(() => getWordBrowse(browseId, term), [browseId, term])

  const close = useCallback(() => {
    stopWordAudio()
    goBack(browse?.returnTo ?? '/words')
  }, [browse?.returnTo])
  const move = useCallback((direction: 'previous' | 'next') => {
    const target = browse?.[direction]
    if (!target || !browse) return
    stopWordAudio()
    navigate(`/word/${encodeURIComponent(target)}`, { browse: browse.id }, {
      replace: true, source: `word:${target}`,
      motion: direction === 'next' ? 'next-word' : 'previous-word',
    })
  }, [browse])

  useEffect(() => {
    let alive = true
    loadWordbookMap().then(map => { if (alive) setEntry(map.get(term)) }).catch(() => { if (alive) setEntry(undefined) })
    return () => { alive = false }
  }, [term, attempt])

  useEffect(() => {
    let alive = true
    setExamples(null)
    setUrls({})
    setPlaying(null)
    setError(null)
    examplesFor(term, card?.contexts).then(async list => {
      if (!alive) return
      setExamples(list)
      const pairs = await Promise.all(list.map(async ex => [`${ex.slug}/${ex.i}`, await clipUrl(ex.slug, ex.i, ex.start)] as const))
      if (!alive) return
      setUrls(Object.fromEntries(pairs))
      for (const [, url] of pairs.slice(0, 2)) void prefetchClip(url)
    }).catch(() => { if (alive) setError('原声例句暂时没加载好，请重试') })
    return () => { alive = false; ++playback.current; stopWordAudio() }
  }, [term, card?.contexts, attempt])

  useEffect(() => {
    // Warm only the next metadata shard; never download a whole round of audio.
    if (browse?.next && !browse.next.includes(' ')) void loadExamples(browse.next).catch(() => {})
  }, [browse?.next])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const direction = event.key === 'ArrowRight' ? 'next' : event.key === 'ArrowLeft' ? 'previous' : null
      if (direction && browse?.[direction]) { event.preventDefault(); move(direction) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [browse, move])

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
    const ticket = ++playback.current
    setPlaying(key)
    const finished = () => { if (ticket === playback.current) setPlaying(null) }
    playClip(url, finished).catch(finished)
  }

  return (
    <div className="word-page">
      <header className="word-header safe-top">
        <button onClick={close} aria-label="返回" className="review-back">
          <ChevronLeftIcon />
        </button>
        {browse && <span className="word-browse-label">{browse.label}</span>}
      </header>
      <main className="word-main overflow-y-auto vertical-scroll">
        <div className="review-word-row">
          <h1 className="review-word" tabIndex={-1} lang="en">{term}</h1>
          <button className="review-speak" onClick={() => { ++playback.current; setPlaying(null); speakWord(term) }} aria-label="单词发音"><Volume2Icon /></button>
        </div>
        <p className="review-phonetic">
          {phonetic && `/${phonetic}/`}
          {entry && <span className="review-tag">{entry.tier === 6 ? '六级新词' : '六级词表'}</span>}
        </p>
        <p className="word-meaning">{meaning || '（暂无释义）'}</p>
        <p className="word-status" role="status">{status}</p>

        <div className="word-actions">
          {!card && <button className="pill-button is-small" onClick={() => addToReview(input)}>加入复习</button>}
          {!card && <button className="pill-button is-soft is-small" onClick={() => markKnown(input)}>我认识，标熟</button>}
          {card?.status === 'learning' && <button className="pill-button is-soft is-small" onClick={() => markKnown(input)}>标熟</button>}
          {card && <button className="pill-button is-soft is-small" onClick={() => relearn(term)}>重新学</button>}
          {card && !card.inBook && <button className="pill-button is-soft is-small" onClick={() => removeCard(term)}>移出</button>}
        </div>

        <h2 className="word-section">原声例句</h2>
        {examples === null && !error && <p className="word-hint" role="status">加载中…</p>}
        {error && <p className="word-hint" role="alert">{error} <button className="word-retry" onClick={() => setAttempt(n => n + 1)}>重新加载</button></p>}
        {examples?.length === 0 && !error && <p className="word-hint">收录的节目里还没有出现过这个词</p>}
        <ul className="word-examples">
          {examples?.map(ex => {
            const meta = manifest.find(m => m.slug === ex.slug)
            const key = `${ex.slug}/${ex.i}`
            return (
              <li key={key} className="word-example">
                <button className={`review-play ${playing === key ? 'is-playing' : ''}`} onClick={() => play(ex)} disabled={!urls[key]} aria-label="播放原声">
                  <PlayIcon />
                </button>
                <div>
                  <p lang="en" className="word-example-en"><HighlightedSentence text={ex.en} w={ex.w} term={term} /></p>
                  {ex.zh && <p className="word-example-zh">{ex.zh}</p>}
                  {meta && (
                    <button className="word-source" onClick={() => { stopWordAudio(); playTalk(ex.slug, ex.start); navigate(`/talk/${ex.slug}`) }}>
                      {ex.own ? '我遇到的 · ' : ''}{showName(meta)} · {meta.title}
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
      {browse && (
        <footer className="word-browser">
          <div className="word-browser-meter" aria-hidden><span style={{ width: `${((browse.index + 1) / browse.total) * 100}%` }} /></div>
          <nav className="word-browser-controls" aria-label="连续浏览单词">
            <button className="word-nav" data-word-nav="previous" onClick={() => move('previous')} disabled={!browse.previous} aria-label="上一个单词" aria-keyshortcuts="ArrowLeft">
              <ChevronLeftIcon aria-hidden /><span>上一个</span>
            </button>
            <p className="word-browser-count" role="status" aria-live="polite" aria-atomic="true"><span className="sr-only">{term}，第 </span>{browse.index + 1}<span aria-hidden> / </span><span className="sr-only"> 个，共 </span>{browse.total}<span className="sr-only"> 个单词</span></p>
            {browse.next ? (
              <button className="word-nav is-next" data-word-nav="next" onClick={() => move('next')} aria-label="下一个单词" aria-keyshortcuts="ArrowRight">
                <span>下一个</span><ChevronRightIcon aria-hidden />
              </button>
            ) : (
              <button className="word-nav is-next" onClick={close}><span>返回列表</span><ChevronRightIcon aria-hidden /></button>
            )}
          </nav>
        </footer>
      )}
    </div>
  )
}
