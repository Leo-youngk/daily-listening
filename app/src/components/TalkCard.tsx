import type { ManifestItem } from '../lib/types'
import { isFinished, loadFavorites, loadProgress } from '../lib/storage'
import { fmtDay } from '../lib/format'
import { navigate } from '../hooks/useHashRoute'
import { CheckIcon, HeartIcon } from 'lucide-react'
import Cover from './Cover'
import { usePlayerActions } from '../store/PlayerContext'

interface Props {
  item: ManifestItem
  /** 本集里你在学的词数（节目页算好传进来） */
  learningHits?: number
}

/** 单集行：16:9 缩略图（底边是收听进度）· 日期与时长 · 标题 · 六级词 */
export default function TalkCard({ item, learningHits }: Props) {
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
    <button onClick={open} className="episode-row">
      <span className="episode-row-thumb">
        <Cover src={item.cover} className="episode-row-img" alt="" />
        {pct > 0 && <i style={{ width: `${pct}%` }} />}
      </span>
      <span className="episode-row-body">
        <span className="episode-row-kicker">
          {fmtDay(item.date)} · {finished ? <><CheckIcon className="episode-row-check" />已听完</> : started ? `剩 ${left} 分钟` : `${minutes} 分钟`}
          {fav && <HeartIcon className="episode-row-fav" aria-label="已收藏" />}
        </span>
        <span className="episode-row-title">{item.title}</span>
        <span className="episode-row-meta">
          六级词 {item.cet6}
          {learningHits ? <b> · 在学 {learningHits}</b> : null}
        </span>
      </span>
    </button>
  )
}
