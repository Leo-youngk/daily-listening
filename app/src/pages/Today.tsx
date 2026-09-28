import { useEffect, useMemo, useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { useCatalog, usePlayerActions } from '../store/PlayerContext'
import { useCards } from '../hooks/useCards'
import { navigate } from '../hooks/useHashRoute'
import Cover from '../components/Cover'
import PageHeader from '../components/PageHeader'
import StudyCard from '../components/StudyCard'
import { LogoMark } from '../components/Icons'
import { isFinished, loadProgress } from '../lib/storage'
import type { ProgressMap } from '../lib/types'
import { loadEpisodeWords, loadWordbook } from '../lib/wordbook'
import type { BookWord } from '../lib/wordbook'
import { seriesInfo } from '../lib/types'
import type { ManifestItem } from '../lib/types'

interface Picks {
  hero: ManifestItem
  /** 主推是没听完的那集时，从上次的位置接着放 */
  resuming: boolean
  tiles: ManifestItem[]
}

/**
 * 今日推荐：主推一集 + 两集备选。
 * 没听完的优先；其次挑"含在学词多、超纲词少"的未听节目；还没开始背词时从最新的 6 Minute English 起步。
 * 备选尽量来自不同节目。
 */
function pickToday(manifest: ManifestItem[], progress: ProgressMap, hits: Record<string, number>): Picks | null {
  const inProgress = manifest
    .filter(m => (progress[m.slug]?.pos ?? 0) > 3 && !isFinished(progress[m.slug]))
    .sort((a, b) => progress[b.slug].updatedAt - progress[a.slug].updatedAt)
  // 点开过但没真正听（进度不到 3 秒）也算没听过
  const fresh = manifest.filter(m => (progress[m.slug]?.pos ?? 0) <= 3 && !isFinished(progress[m.slug]))
  const score = (m: ManifestItem) => (hits[m.slug] ?? 0) * 2 - m.hard / 25 + (m.category === 'bbc' ? 1 : 0)
  const ranked = [...fresh].sort((a, b) => score(b) - score(a))
  const noHits = !ranked.some(m => hits[m.slug])
  const firstFresh = noHits ? (fresh.find(m => m.category === 'bbc') ?? fresh[0]) : ranked[0]

  const hero = inProgress[0] ?? firstFresh
  if (!hero) return null
  const pool = [...inProgress.slice(1), ...(noHits ? fresh : ranked)].filter(m => m.slug !== hero.slug)
  const tiles: ManifestItem[] = []
  for (const m of pool) {
    if (tiles.length === 2) break
    if (m.category !== hero.category && !tiles.some(t => t.category === m.category)) tiles.push(m)
  }
  // 没听过的不够两集时，用听完的补位（可以重听），不让网格缺一格
  for (const m of [...pool, ...manifest.filter(m => isFinished(progress[m.slug]) && m.slug !== hero.slug)]) {
    if (tiles.length === 2) break
    if (!tiles.includes(m)) tiles.push(m)
  }
  return { hero, resuming: !!inProgress[0], tiles }
}

export default function Today() {
  const { manifest, manifestReady, manifestError, reloadManifest } = useCatalog()
  const { playTalk, primeTalk } = usePlayerActions()
  const { cards, ready } = useCards()
  const [vocab, setVocab] = useState<{ words: BookWord[]; episodes: Record<string, number[]> } | null>(null)

  useEffect(() => {
    Promise.all([loadWordbook(), loadEpisodeWords()])
      .then(([words, episodes]) => setVocab({ words, episodes }))
      .catch(error => {
        console.error('wordbook load failed, recommending without it', error)
        setVocab({ words: [], episodes: {} })
      })
  }, [])

  const progress = loadProgress()
  const picks = useMemo(() => {
    if (!manifest.length || !ready || !vocab) return null
    const learning = new Set([...cards.values()].filter(c => c.status === 'learning').map(c => c.term))
    const hits: Record<string, number> = {}
    if (learning.size) {
      for (const [slug, indices] of Object.entries(vocab.episodes)) {
        hits[slug] = indices.filter(k => learning.has(vocab.words[k]?.word)).length
      }
    }
    return pickToday(manifest, progress, hits)
    // progress 每次渲染都重新读，按 manifest/卡片变化重算即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, ready, cards, vocab])

  // 没听完的集由播放器自己从上次的位置接着放，这里不传起点
  const open = (item: ManifestItem) => {
    playTalk(item.slug)
    navigate(`/talk/${item.slug}`)
  }

  const hero = picks?.hero
  // 主推最可能被点：播放器空着时先预挂上，点下去几乎立刻出声
  useEffect(() => {
    if (hero) primeTalk(hero.slug)
  }, [hero, primeTalk])
  const heroEntry = hero ? progress[hero.slug] : undefined
  const heroPct = hero && heroEntry && hero.duration ? Math.min(100, (heroEntry.pos / hero.duration) * 100) : 0

  return (
    <div className="page today-page">
      <PageHeader brand={<h1 className="app-logo-wrap"><LogoMark className="app-logo" /><span className="sr-only">每日听力 · 今日</span></h1>} />

      {manifestError ? (
        <div className="page-status">
          <p>{manifestError}</p>
          <button className="pill-button is-soft is-small" onClick={reloadManifest}>重新加载</button>
        </div>
      ) : !manifestReady || !picks || !hero ? (
        manifestReady && manifest.length === 0 ? (
          <p className="page-status">还没有节目</p>
        ) : (
          <div aria-busy className="today-skeleton">
            <div className="skeleton today-skeleton-hero" />
            <div className="skeleton today-skeleton-line" />
            <div className="skeleton today-skeleton-line is-short" />
            <div className="today-grid">
              <div className="skeleton today-skeleton-tile" />
              <div className="skeleton today-skeleton-tile" />
            </div>
          </div>
        )
      ) : (
        <>
          <button className="today-hero" onClick={() => open(hero)} aria-label={`${picks.resuming ? '继续听' : '播放'}：${hero.title}`}>
            <span className="today-hero-art">
              <Cover src={hero.cover} className="today-hero-cover" alt="" />
            </span>
            <span className="today-hero-progress" aria-hidden><span style={{ width: `${heroPct}%` }} /></span>
            <span className="today-hero-meta">
              <span className="today-hero-copy">
                <span className="today-hero-title">{hero.title}</span>
                <span className="today-hero-series">{seriesInfo(hero.category).name}</span>
              </span>
              <ChevronRightIcon aria-hidden />
            </span>
          </button>

          {picks.tiles.length > 0 && (
            <div className="today-grid">
              {picks.tiles.map(item => {
                const entry = progress[item.slug]
                const pct = entry && item.duration && !isFinished(entry) ? Math.min(100, (entry.pos / item.duration) * 100) : 0
                return (
                  <button key={item.slug} className="today-tile" onClick={() => open(item)}>
                    <span className="today-tile-art">
                      <Cover src={item.cover} className="today-tile-cover" alt="" />
                      {pct > 0 && <i style={{ width: `${pct}%` }} />}
                    </span>
                    <span className="today-tile-title">{item.title}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      <div className="today-study">
        <StudyCard />
      </div>
    </div>
  )
}
