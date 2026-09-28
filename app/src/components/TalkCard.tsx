import type { ManifestItem } from '../lib/types'
import { seriesInfo } from '../lib/types'
import { isFinished, loadFavorites, loadProgress } from '../lib/storage'
import { fmtDay } from '../lib/format'
import { navigate } from '../hooks/useHashRoute'
import { CheckIcon, HeartIcon, PlayIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import Cover from './Cover'
import { usePlayer, usePlayerActions } from '../store/PlayerContext'

interface Props {
  item: ManifestItem
  /** 本集里你在学的词数（节目页算好传进来） */
  learningHits?: number
}

/** 正在播放的小音柱：播放时跳动，暂停时停住 */
function NowPlayingBars({ playing }: { playing: boolean }) {
  return (
    <span className={cn('now-bars', playing && 'is-playing')} aria-hidden>
      <i /><i /><i />
    </span>
  )
}

/** 单集行：16:9 缩略图 · 日期与节目 · 标题 · 时长与六级词 · 播放圆钮；正在播放的那集标音柱与进度线 */
export default function TalkCard({ item, learningHits }: Props) {
  const { playTalk } = usePlayerActions()
  const { slug: currentSlug, playing } = usePlayer()
  const progress = loadProgress()[item.slug]
  const finished = isFinished(progress)
  const fav = loadFavorites().includes(item.slug)
  const current = currentSlug === item.slug
  const started = !!progress && progress.pos > 3 && !finished
  const minutes = Math.max(1, Math.round((item.duration || 0) / 60))
  const left = started ? Math.max(1, Math.round((item.duration - progress.pos) / 60)) : minutes
  const pct = (started || current) && progress && item.duration ? Math.min(100, (progress.pos / item.duration) * 100) : 0
  const open = () => {
    playTalk(item.slug)
    navigate(`/talk/${item.slug}`)
  }

  return (
    <button onClick={open} className={cn('episode-row', current && 'is-current')} aria-current={current ? 'true' : undefined}>
      <span className="episode-row-thumb">
        <Cover src={item.cover} className="episode-row-img" alt="" />
      </span>
      <span className="episode-row-body">
        <span className="episode-row-kicker">
          {current && <NowPlayingBars playing={playing} />}
          <span className="truncate">{fmtDay(item.date)} · {seriesInfo(item.category).name}</span>
          {fav && <HeartIcon className="episode-row-fav" aria-label="已收藏" />}
        </span>
        <span className="episode-row-title">{item.title}</span>
        <span className="episode-row-foot">
          <span className="episode-row-meta">
            {finished ? <><CheckIcon className="episode-row-check" />已听完</> : started ? `剩 ${left} 分钟` : `${minutes} 分钟`}
            {' · '}六级词 {item.cet6}
            {learningHits ? <b> · 在学 {learningHits}</b> : null}
          </span>
          <span className="episode-row-play" aria-hidden><PlayIcon /></span>
        </span>
        {pct > 0 && <span className="episode-row-progress" aria-hidden><span style={{ width: `${pct}%` }} /></span>}
      </span>
    </button>
  )
}
