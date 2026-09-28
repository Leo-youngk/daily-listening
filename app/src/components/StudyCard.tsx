import { BookOpenIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { navigate } from '../hooks/useHashRoute'
import { useStudySummary } from '../hooks/useStudySummary'

/**
 * 背词入口卡：今天待复习与新词额度 + 开始按钮。
 * detailed 版（单词页）多一条词表进度。
 */
export default function StudyCard({ detailed = false, total = 0 }: { detailed?: boolean; total?: number }) {
  const s = useStudySummary()
  const allDone = s.ready && s.due === 0 && s.fresh === 0
  const untouched = Math.max(0, total - s.mastered - s.learning)
  const masteredPct = total ? Math.min(100, (s.mastered / total) * 100) : 0
  const learningPct = total ? Math.min(100 - masteredPct, (s.learning / total) * 100) : 0

  return (
    <section className={cn('study-card', detailed && 'is-detailed')}>
      <div className="study-card-row">
        <BookOpenIcon className="study-card-icon" aria-hidden />
        <div className="study-card-copy">
          <p className="study-card-title">六级单词</p>
          <p className="study-card-sub">
            {!s.ready ? '待复习 – · 新词 –' : allDone ? '今天的单词背完了' : `待复习 ${s.due} · 新词 ${s.fresh}`}
          </p>
        </div>
        {allDone ? (
          <span className="pill-button is-soft is-static">已完成</span>
        ) : (
          <button className="pill-button" onClick={() => navigate('/review')} disabled={!s.ready}>开始</button>
        )}
      </div>
      {detailed && (
        <>
          <div className="study-card-meter" aria-hidden>
            <span className="is-mastered" style={{ width: `${masteredPct}%` }} />
            <span className="is-learning" style={{ width: `${learningPct}%` }} />
          </div>
          <p className="study-card-stats">
            <span><b>{s.mastered}</b> 已掌握</span>
            <span><b>{s.learning}</b> 学习中</span>
            <span><b>{total ? untouched : '–'}</b> 未学</span>
          </p>
        </>
      )}
    </section>
  )
}
