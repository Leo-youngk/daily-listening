import { useEffect, useMemo, useState } from 'react'
import { useCatalog, usePlayerActions } from '../store/PlayerContext'
import { loadHomeRotation, loadProgress, saveHomeRotation } from '../lib/storage'
import { navigate } from '../hooks/useHashRoute'
import { fmtTime } from '../lib/format'
import { ChevronRightIcon, PlayIcon, RefreshCwIcon, SearchIcon, Settings2Icon, SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import TalkCard from '../components/TalkCard'
import Cover from '../components/Cover'
import { localDateKey } from '../lib/date'
import { fetchJson } from '../lib/http'
import type { HomeRotation } from '../lib/storage'
import type { ManifestItem, ProgressMap, TalkData } from '../lib/types'

/** 每日一句：按日期固定取一句，避免刷新后变化 */
function useDailyQuote(manifest: { slug: string }[], dayKey: string) {
  return useMemo(() => {
    if (manifest.length === 0) return null
    let seed = 0
    for (const c of dayKey) seed = (seed * 31 + c.charCodeAt(0)) >>> 0
    return { talkIdx: seed % manifest.length, seed }
  }, [dayKey, manifest])
}

function useLocalDayKey() {
  const [dayKey, setDayKey] = useState(localDateKey)

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = localDateKey()
      setDayKey(previous => previous === next ? previous : next)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return dayKey
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickRandom<T>(arr: T[], count: number, seed: number): T[] {
  const rng = mulberry32(seed)
  const pool = [...arr]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count)
}

const RECOMMENDATION_COUNT = 7
const COMMENCEMENT_COUNT = 3
const RECENT_HISTORY_SIZE = 18

function seedFor(...parts: string[]) {
  let seed = 2166136261
  for (const part of parts) {
    for (const char of part) {
      seed = Math.imul(seed ^ char.charCodeAt(0), 16777619)
    }
  }
  return seed >>> 0
}

function progressRank(item: ManifestItem, progress: ProgressMap) {
  const saved = progress[item.slug]
  if (!saved || saved.pos <= 3) return 0
  const duration = saved.duration || item.duration
  return saved.pos < Math.max(0, duration - 15) ? 1 : 2
}

/** 在未听、进行中、已完成三个层级里轮换，避免首页只按清单顺序取内容。 */
function pickForHome(
  pool: ManifestItem[],
  count: number,
  seed: number,
  progress: ProgressMap,
  recent: string[],
  excluded: string[] = [],
) {
  const hardBlocked = new Set(excluded.filter(Boolean))
  const recentSet = new Set(recent)
  const buckets = [0, 1, 2].map(rank => pool.filter(item => progressRank(item, progress) === rank))
  const fresh = buckets.flatMap((bucket, index) =>
    pickRandom(bucket, bucket.length, seed + (index + 1) * 0x9E3779B9)
      .filter(item => !hardBlocked.has(item.slug) && !recentSet.has(item.slug)),
  )
  const fallback = buckets.flatMap((bucket, index) =>
    pickRandom(bucket, bucket.length, seed + (index + 4) * 0x9E3779B9)
      .filter(item => !hardBlocked.has(item.slug)),
  )
  const unique = new Map<string, ManifestItem>()
  for (const item of [...fresh, ...fallback]) unique.set(item.slug, item)
  return [...unique.values()].slice(0, count)
}

function buildHomeRotation(
  manifest: ManifestItem[],
  progress: ProgressMap,
  date: string,
  cycle: number,
  recent: string[],
  featuredSlug?: string,
): HomeRotation {
  const recommendations = pickForHome(
    manifest,
    RECOMMENDATION_COUNT,
    seedFor(date, String(cycle), 'recommendations'),
    progress,
    recent,
    featuredSlug ? [featuredSlug] : [],
  )
  const recommendationSlugs = recommendations.map(item => item.slug)
  const commencement = pickForHome(
    manifest.filter(item => item.category === 'commencement'),
    COMMENCEMENT_COUNT,
    seedFor(date, String(cycle), 'commencement'),
    progress,
    [...recent, ...recommendationSlugs],
    [featuredSlug, ...recommendationSlugs].filter((slug): slug is string => Boolean(slug)),
  )
  const selected = [...recommendationSlugs, ...commencement.map(item => item.slug)]
  return {
    date,
    cycle,
    recommendations: recommendationSlugs,
    commencement: commencement.map(item => item.slug),
    recent: [...new Set([...recent, ...selected])].slice(-RECENT_HISTORY_SIZE),
  }
}

function isUsableRotation(
  rotation: HomeRotation | null,
  manifest: ManifestItem[],
  date: string,
  progress: ProgressMap,
  featuredSlug?: string,
) {
  if (!rotation || rotation.date !== date || rotation.cycle < 0) return false
  const available = new Set(manifest.map(item => item.slug))
  const validIds = (ids: string[]) => ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => available.has(id))
  if (!validIds(rotation.recommendations) || !validIds(rotation.commencement)) return false
  if (featuredSlug && (rotation.recommendations.includes(featuredSlug) || rotation.commencement.includes(featuredSlug))) return false
  const selected = new Set([...rotation.recommendations, ...rotation.commencement])
  const hasFreshAlternative = manifest.some(item => !selected.has(item.slug) && progressRank(item, progress) < 2)
  const hasCompletedSelection = [...selected].some(slug => {
    const item = manifest.find(candidate => candidate.slug === slug)
    return item ? progressRank(item, progress) === 2 : false
  })
  if (hasFreshAlternative && hasCompletedSelection) return false
  return true
}

export default function Discover() {
  const { manifest, manifestReady, manifestError, reloadManifest } = useCatalog()
  const { playTalk } = usePlayerActions()
  const [quote, setQuote] = useState<{ en: string; zh: string; title: string; slug: string; at: number } | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [rotationState, setRotationState] = useState<HomeRotation | null>(() => loadHomeRotation())
  const dayKey = useLocalDayKey()
  const daily = useDailyQuote(manifest, dayKey)
  const [progress] = useState(() => loadProgress())

  const dateStr = useMemo(() => {
    const [, month, day] = dayKey.split('-')
    return `${Number(month)}月${Number(day)}日`
  }, [dayKey])

  // 继续学习
  const lastPlayed = useMemo(() => {
    const entries = Object.entries(progress).filter(([, v]) => v.pos > 3 && v.pos < v.duration - 15)
    if (!entries.length) return null
    entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    const [slug, v] = entries[0]
    const meta = manifest.find(m => m.slug === slug)
    return meta ? { meta, pos: v.pos } : null
  }, [manifest, progress])

  const featuredSlug = lastPlayed?.meta.slug
  const homeRotation = useMemo(() => {
    if (!manifest.length) return null
    if (isUsableRotation(rotationState, manifest, dayKey, progress, featuredSlug)) return rotationState
    return buildHomeRotation(
      manifest,
      progress,
      dayKey,
      rotationState?.date === dayKey ? rotationState.cycle : 0,
      rotationState?.recent ?? [],
      featuredSlug,
    )
  }, [dayKey, featuredSlug, manifest, progress, rotationState])

  useEffect(() => {
    if (homeRotation && homeRotation !== rotationState) saveHomeRotation(homeRotation)
  }, [homeRotation, rotationState])

  const recs = useMemo(
    () => homeRotation?.recommendations
      .map(slug => manifest.find(item => item.slug === slug))
      .filter((item): item is ManifestItem => Boolean(item)) ?? [],
    [homeRotation, manifest],
  )

  const featured = lastPlayed?.meta ?? recs[0] ?? manifest[0] ?? null
  const featuredPosition = lastPlayed?.pos ?? 0
  const nextUp = recs.filter(item => item.slug !== featured?.slug).slice(0, 6)
  const commencement = useMemo(
    () => homeRotation?.commencement
      .map(slug => manifest.find(item => item.slug === slug))
      .filter((item): item is ManifestItem => Boolean(item)) ?? [],
    [homeRotation, manifest],
  )

  const rotateHome = () => {
    if (!manifest.length) return
    const current = homeRotation ?? buildHomeRotation(manifest, progress, dayKey, 0, [], featuredSlug)
    const next = buildHomeRotation(
      manifest,
      progress,
      dayKey,
      current.cycle + 1,
      current.recent,
      featuredSlug,
    )
    setRotationState(next)
    saveHomeRotation(next)
  }

  // 加载每日一句（懒加载该篇字幕，随机挑一句有中文的）
  useEffect(() => {
    if (!daily) return
    const meta = manifest[daily.talkIdx]
    if (!meta) return
    const controller = new AbortController()
    setQuote(null)
    setQuoteError(null)
    setQuoteLoading(true)
    fetchJson<TalkData>(`/data/${encodeURIComponent(meta.slug)}.json`, {
      signal: controller.signal,
      timeoutMs: 12_000,
      retries: 1,
    })
      .then(data => {
        const cands = data.sentences.filter((s: { en: string; zh: string }) => s.en.length > 40 && s.en.length < 160 && s.zh)
        if (cands.length) {
          const s = cands[daily.seed % cands.length]
          setQuote({ en: s.en, zh: s.zh, title: meta.title, slug: meta.slug, at: s.start })
        } else setQuoteError('今天的演讲没有可用金句')
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setQuoteError(error instanceof Error ? error.message : '每日一句加载失败')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuoteLoading(false)
      })
    return () => controller.abort()
  }, [daily, manifest])

  if (!manifestReady) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
  }
  if (manifestError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-destructive">{manifestError}</p>
        <Button onClick={reloadManifest} className="rounded-full px-4">重新加载</Button>
      </div>
    )
  }

  return (
    <div className="discover-page">
      <header className="discover-header safe-top">
        <div>
          <p className="discover-date">{dateStr} · 每日听力</p>
          <h1>现在就听</h1>
        </div>
        <div className="discover-actions">
          <button aria-label="搜索" onClick={() => navigate('/library')}><SearchIcon /></button>
          <button aria-label="设置" onClick={() => navigate('/me')}><Settings2Icon /></button>
        </div>
      </header>

      {featured && (
        <section className="discover-feature">
          <div className="discover-feature-cover">
            {featured.cover ? <Cover src={featured.cover} className="size-full object-cover" alt={featured.title} /> : <span>{featured.category.toUpperCase()}</span>}
            <div className="discover-feature-badge">{lastPlayed ? '继续学习' : '今日推荐'}</div>
          </div>
          <div className="discover-feature-copy">
            <p className="discover-eyebrow">{featured.category === 'ted' ? 'TED 演讲' : featured.category === 'commencement' ? '毕业演讲' : featured.category.toUpperCase()}</p>
            <h2>{featured.title}</h2>
            <p className="discover-feature-meta">{featured.speaker} · {Math.round(featured.duration / 60)} 分钟</p>
            {lastPlayed && <Progress value={Math.min(100, (featuredPosition / featured.duration) * 100)} className="discover-feature-progress" />}
            <div className="discover-feature-footer">
              <span>{lastPlayed ? `上次听到 ${fmtTime(featuredPosition)}` : '从头开始'}</span>
              <Button
                size="sm"
                className="discover-play-button"
                onClick={() => { playTalk(featured.slug, featuredPosition); navigate(`/talk/${featured.slug}`) }}
              >
                <PlayIcon className="size-4 fill-current" />
                {lastPlayed ? '继续播放' : '开始收听'}
              </Button>
            </div>
          </div>
        </section>
      )}

      <section className="discover-section">
        <div className="discover-section-head">
          <div><p className="discover-eyebrow">下一篇</p><h2>接下来听</h2></div>
          <button onClick={() => navigate('/library')} className="discover-more">全部 <ChevronRightIcon /></button>
        </div>
        <div className="discover-rail overflow-x-auto horizontal-scroll">
          {nextUp.map(item => (
            <button key={item.slug} className="discover-rail-card" onClick={() => { playTalk(item.slug); navigate(`/talk/${item.slug}`) }}>
              <div className="discover-rail-cover">
                {item.cover ? <Cover src={item.cover} className="size-full object-cover" alt={item.title} /> : <span>{item.category.toUpperCase()}</span>}
              </div>
              <p>{item.title}</p>
              <small>{item.speaker}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="discover-section discover-quote-section">
        <div className="discover-section-head">
          <div><p className="discover-eyebrow"><SparklesIcon /> 今日摘句</p><h2>一句话，听懂一场演讲</h2></div>
        </div>
        {quoteLoading && <p className="discover-quote-placeholder">正在挑选今天的句子…</p>}
        {quoteError && !quoteLoading && <p className="discover-quote-placeholder">{quoteError}</p>}
        {quote && (
          <button className="discover-quote" onClick={() => { playTalk(quote.slug, quote.at); navigate(`/talk/${quote.slug}`) }}>
            <p className="discover-quote-en">“{quote.en}”</p>
            <p className="discover-quote-zh">{quote.zh}</p>
            <span>{quote.title} · 从这里开始听 <ChevronRightIcon /></span>
          </button>
        )}
      </section>

      <section className="discover-section discover-commencement">
        <div className="discover-section-head">
          <div><p className="discover-eyebrow">精选合集</p><h2>毕业演讲</h2></div>
          <div className="discover-section-actions">
            <button onClick={rotateHome} className="discover-refresh" aria-label="换一批首页推荐">
              <RefreshCwIcon />
              换一批
            </button>
            <button onClick={() => navigate('/library?tab=commencement')} className="discover-more">更多 <ChevronRightIcon /></button>
          </div>
        </div>
        <div className="discover-list">
          {commencement.map(item => <TalkCard key={item.slug} item={item} showProgress={false} />)}
        </div>
      </section>
    </div>
  )
}
