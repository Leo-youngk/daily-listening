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
    <nav className="glass safe-bottom border-t border-line">
      <div className="flex">
        {tabs.map(t => {
          const active = page === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => navigate(t.path)}
              className="flex flex-1 flex-col items-center gap-0.5 py-2"
            >
              <Icon
                strokeWidth={active ? 2.2 : 1.8}
                className={`size-6 ${active ? 'text-primary' : 'text-muted-foreground'}`}
              />
              <span className={`text-[10px] ${active ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                {t.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
