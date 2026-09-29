import type { ComponentType, SVGProps } from 'react'
import { navigate } from '../hooks/useHashRoute'
import { useStudySummary } from '../hooks/useStudySummary'
import { BookIcon, PersonIcon, ShowsIcon } from './Icons'

type TabIcon = ComponentType<SVGProps<SVGSVGElement> & { active?: boolean }>

const tabs: { key: string; label: string; path: string; Icon: TabIcon }[] = [
  { key: 'programs', label: '节目', path: '/programs', Icon: ShowsIcon },
  { key: 'words', label: '单词', path: '/words', Icon: BookIcon },
  { key: 'me', label: '我的', path: '/me', Icon: PersonIcon },
]

/** 悬浮底栏；「单词」角标是今天待复习的词数，清零就不显示 */
export default function TabBar({ page }: { page: string }) {
  const { ready, due } = useStudySummary()
  const badge = ready && due > 0 ? (due > 99 ? '99+' : String(due)) : null

  return (
    <nav aria-label="主导航" className="app-tab-bar">
      {tabs.map(({ key, label, path, Icon }) => {
        const active = page === key
        const count = key === 'words' ? badge : null
        return (
          <button
            key={key}
            onClick={() => navigate(path)}
            aria-current={active ? 'page' : undefined}
            aria-label={count ? `${label}，${count} 个待复习` : undefined}
            className={`app-tab ${active ? 'is-active' : ''}`}
          >
            <Icon active={active} className="app-tab-icon" />
            {count && <em className="app-tab-badge" aria-hidden>{count}</em>}
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
