import { BookOpenIcon } from 'lucide-react'
import { navigate } from '../hooks/useHashRoute'
import { useStudySummary } from '../hooks/useStudySummary'

/** 背词入口卡（今日页）：今天待复习与新词额度 + 开始按钮 */
export default function StudyCard() {
  const s = useStudySummary()
  const allDone = s.ready && s.due === 0 && s.fresh === 0

  return (
    <section className="study-card">
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
    </section>
  )
}
