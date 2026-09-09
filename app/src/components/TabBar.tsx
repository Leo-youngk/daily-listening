import { navigate } from '../hooks/useHashRoute'
import { BookOpenIcon, CompassIcon, HeadphonesIcon, UserIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const tabs: { key: string; label: string; path: string; icon: LucideIcon }[] = [
  { key: 'discover', label: '发现', path: '/', icon: CompassIcon },
  { key: 'library', label: '听力库', path: '/library', icon: HeadphonesIcon },
  { key: 'vocab', label: '生词本', path: '/vocab', icon: BookOpenIcon },
  { key: 'me', label: '我的', path: '/me', icon: UserIcon },
]

export default function TabBar({ page }: { page: string }) {
  return (
    <nav aria-label="主导航" className="app-tab-bar safe-bottom">
      <div className="app-tab-bar-inner">
        {tabs.map(t => {
          const active = page === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => navigate(t.path)}
              aria-current={active ? 'page' : undefined}
              className={`app-tab ${active ? 'is-active' : ''}`}
            >
              <Icon
                strokeWidth={active ? 2.2 : 1.8}
                className="app-tab-icon"
              />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
