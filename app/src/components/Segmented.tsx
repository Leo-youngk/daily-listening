import { cn } from '@/lib/utils'

interface Props<T extends string> {
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
  label: string
  /** tabs：切换视图；choice：设置里的单选 */
  kind?: 'tabs' | 'choice'
  size?: 'md' | 'sm'
  className?: string
}

/** 胶囊分段控件：灰色轨道 + 白色选中块，选中文字用主色 */
export default function Segmented<T extends string>({
  value, options, onChange, label, kind = 'tabs', size = 'md', className,
}: Props<T>) {
  const tabs = kind === 'tabs'
  return (
    <div role={tabs ? 'tablist' : 'radiogroup'} aria-label={label} className={cn('segmented', size === 'sm' && 'is-small', className)}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role={tabs ? 'tab' : 'radio'}
          aria-selected={tabs ? value === key : undefined}
          aria-checked={tabs ? undefined : value === key}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
