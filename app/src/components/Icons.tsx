import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>
type TabIconProps = IconProps & { active?: boolean }

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}
/** 实心图标里的镂空部分跟底栏底色走，深浅色都成立 */
const cutout = { fill: 'var(--color-float)' }

export function ShowsIcon({ active, ...props }: TabIconProps) {
  const triangle = 'M10 8.9v6.2a.7.7 0 0 0 1.05.6l5-3.1a.7.7 0 0 0 0-1.2l-5-3.1a.7.7 0 0 0-1.05.6z'
  return active ? (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <circle cx="12" cy="12" r="9.4" fill="currentColor" />
      <path d={triangle} style={cutout} />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d={triangle} />
    </svg>
  )
}

export function BookIcon({ active, ...props }: TabIconProps) {
  const cover = 'M3 5.5a1 1 0 0 1 1-1h4.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 3.5-3.5H20a1 1 0 0 1 1 1V17a1 1 0 0 1-1 1h-5a3 3 0 0 0-3 3 3 3 0 0 0-3-3H4a1 1 0 0 1-1-1z'
  return active ? (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d={cover} fill="currentColor" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
      <path d="M12 8.6v10.2" strokeWidth={1.6} strokeLinecap="round" style={{ stroke: 'var(--color-float)' }} />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d={cover} />
      <path d="M12 8v13" />
    </svg>
  )
}

export function PersonIcon({ active, ...props }: TabIconProps) {
  return active ? (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <circle cx="12" cy="8" r="4.4" fill="currentColor" />
      <path fill="currentColor" d="M3.8 20.1a8.2 8.2 0 0 1 16.4 0 .9.9 0 0 1-.9.9H4.7a.9.9 0 0 1-.9-.9z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </svg>
  )
}

/** 播放页"词汇"：一页笔记 */
export function NotesIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
    </svg>
  )
}
