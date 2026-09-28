import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props<T extends string> {
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
  label: string
  /** 右侧附注（如"共 N 期"） */
  aside?: ReactNode
  className?: string
}

/** 文字 + 玫红短下划线的次级筛选：比胶囊分段轻，放在列表正上方 */
export default function UnderlineTabs<T extends string>({ value, options, onChange, label, aside, className }: Props<T>) {
  return (
    <div className={cn('underline-tabs', className)}>
      <div role="tablist" aria-label={label} className="underline-tabs-list">
        {options.map(([key, text]) => (
          <button key={key} type="button" role="tab" aria-selected={value === key} onClick={() => onChange(key)}>
            {text}
          </button>
        ))}
      </div>
      {aside && <span className="underline-tabs-aside">{aside}</span>}
    </div>
  )
}
