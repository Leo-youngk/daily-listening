import type { ReactNode } from 'react'
import { SearchIcon } from 'lucide-react'
import { navigate } from '../hooks/useHashRoute'

/** Tab 页顶栏：左侧大标题（或品牌标），右侧搜索入口 */
export default function PageHeader({ title, search = false }: { title: ReactNode; search?: boolean }) {
  return (
    <header className="page-header safe-top">
      {typeof title === 'string' ? <h1 className="page-title">{title}</h1> : title}
      {search && (
        <button className="header-icon" onClick={() => navigate('/search')} aria-label="搜索">
          <SearchIcon />
        </button>
      )}
    </header>
  )
}
