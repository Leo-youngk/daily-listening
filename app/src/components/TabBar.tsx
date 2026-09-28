import type { ComponentType, SVGProps } from 'react'
import { navigate } from '../hooks/useHashRoute'
import { BookIcon, HomeIcon, PersonIcon, ShowsIcon } from './Icons'

type TabIcon = ComponentType<SVGProps<SVGSVGElement> & { active?: boolean }>

const tabs: { key: string; label: string; path: string; Icon: TabIcon }[] = [
  { key: 'today', label: '今日', path: '/', Icon: HomeIcon },
  { key: 'programs', label: '节目', path: '/programs', Icon: ShowsIcon },
  { key: 'words', label: '单词', path: '/words', Icon: BookIcon },
  { key: 'me', label: '我的', path: '/me', Icon: PersonIcon },
]

export default function TabBar({ page }: { page: string }) {
  return (
    <nav aria-label="主导航" className="app-tab-bar safe-bottom">
      <div className="app-tab-bar-inner">
        {tabs.map(({ key, label, path, Icon }) => {
          const active = page === key
          return (
            <button
              key={key}
              onClick={() => navigate(path)}
              aria-current={active ? 'page' : undefined}
              className={`app-tab ${active ? 'is-active' : ''}`}
            >
              <Icon active={active} className="app-tab-icon" />
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
