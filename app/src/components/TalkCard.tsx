import type { ManifestItem } from '../lib/types'
import { seriesInfo } from '../lib/types'
import { isFinished, loadFavorites, loadProgress } from '../lib/storage'
import { fmtDay } from '../lib/format'
import { navigate } from '../hooks/useHashRoute'
import { CheckIcon, HeartIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import Cover from './Cover'
import { usePlayerActions } from '../store/PlayerContext'

interface Props {
  item: ManifestItem
  /** 本集里你在学的词数（节目页算好传进来） */
  learningHits?: number
  /** 跨频道列表里标出节目名 */
  showSeries?: boolean
  /** 当前播放器里的这一集：播放中音柱会动，暂停时静止 */
  nowPlaying?: 'playing' | 'paused'
}

/** 单集行：16:9 缩略图（底边是收听进度）· 日期与来源 · 标题 · 时长与六级词 */
export default function TalkCard({ item, learningHits, showSeries = false, nowPlaying }: Props) {
  const { playTalk } = usePlayerActions()
  const progress = loadProgress()[item.slug]
  const finished = isFinished(progress)
  const fav = loadFavorites().includes(item.slug)
  const started = !!progress && progress.pos > 3 && !finished
  const minutes = Math.max(1, Math.round((item.duration || 0) / 60))
  const left = started ? Math.max(1, Math.round((item.duration - progress.pos) / 60)) : minutes
  const pct = started && item.duration ? Math.min(100, (progress.pos / item.duration) * 100) : 0
  const open = () => {
    playTalk(item.slug)
    navigate(`/talk/${item.slug}`)
  }

  return (
    <button onClick={open} className="episode-row" aria-current={nowPlaying ? 'true' : undefined}>
      <span className="episode-row-thumb">
        <Cover src={item.cover} className="episode-row-img" alt="" />
        {pct > 0 && <i style={{ width: `${pct}%` }} />}
      </span>
      <span className="episode-row-body">
        <span className="episode-row-kicker">
          {nowPlaying && (
            <span className={cn('now-bars', nowPlaying === 'playing' && 'is-playing')} aria-label="正在播放">
              <i /><i /><i />
            </span>
          )}
          {fmtDay(item.date)}
          {showSeries && ` · ${seriesInfo(item.category).name}`}
          {fav && <HeartIcon className="episode-row-fav" aria-label="已收藏" />}
        </span>
        <span className="episode-row-title">{item.title}</span>
        <span className="episode-row-meta">
          {finished ? <><CheckIcon className="episode-row-check" />已听完</> : started ? `剩 ${left} 分钟` : `${minutes} 分钟`}
          {' · '}六级词 {item.cet6}
          {learningHits ? <b> · 在学 {learningHits}</b> : null}
        </span>
      </span>
    </button>
  )
}
