import type { ReactNode } from 'react'
import { SearchIcon } from 'lucide-react'
import { navigate } from '../hooks/useHashRoute'

/** 今日页顶栏：左侧品牌标，右侧搜索入口（其他 Tab 不放大标题） */
export default function PageHeader({ brand }: { brand: ReactNode }) {
  return (
    <header className="page-header safe-top">
      {brand}
      <button className="header-icon" onClick={() => navigate('/search')} aria-label="搜索">
        <SearchIcon />
      </button>
    </header>
  )
}
