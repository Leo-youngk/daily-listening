import type { ManifestItem } from '../lib/types'
import { showTab } from '../lib/types'
import { isFinished, loadFavorites, loadProgress } from '../lib/storage'
import { fmtDay, fmtMinutes } from '../lib/format'
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

/** 单集行：16:9 缩略图（底边是收听进度）· 标题 · 「日期 · 节目 · 时长」与在学词标签 */
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

  const series = showSeries ? showTab(item) : null
  const length = started ? `剩 ${fmtMinutes(left)}` : fmtMinutes(minutes)
  const meta = nowPlaying
    ? [nowPlaying === 'playing' ? '正在播放' : '已暂停', length]
    : finished
      ? ['已听完', fmtDay(item.date), series]
      : [fmtDay(item.date), series, length]

  return (
    <button onClick={open} className="episode-row" aria-current={nowPlaying ? 'true' : undefined}>
      <span className="episode-row-thumb">
        <Cover src={item.cover} className="episode-row-img" alt="" />
        {pct > 0 && <i style={{ width: `${pct}%` }} />}
      </span>
      <span className="episode-row-body">
        <span className="episode-row-title">{item.title}</span>
        <span className="episode-row-meta">
          {meta.filter(Boolean).map((part, i) => (
            <span key={part} className="episode-row-meta-part">
              {i === 0 && nowPlaying && (
                <span className={cn('now-bars', nowPlaying === 'playing' && 'is-playing')} aria-hidden>
                  <i /><i /><i />
                </span>
              )}
              {i === 0 && finished && !nowPlaying && <CheckIcon className="episode-row-check" aria-hidden />}
              {part}
            </span>
          ))}
          {fav && <HeartIcon className="episode-row-fav" aria-label="已收藏" />}
          {!finished && learningHits ? <b className="episode-row-hits">在学 {learningHits}</b> : null}
        </span>
      </span>
    </button>
  )
}
