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
/** 实心图标里的镂空部分跟页面底色走，深浅色都成立 */
const cutout = { fill: 'var(--color-bg)' }

/** 品牌标：声波 */
export function LogoMark(props: IconProps) {
  const bars = [9, 16, 24, 16, 9]
  return (
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden {...props}>
      {bars.map((h, i) => <line key={i} x1={4 + i * 5} x2={4 + i * 5} y1={14 - h / 2} y2={14 + h / 2} />)}
    </svg>
  )
}

export function HomeIcon({ active, ...props }: TabIconProps) {
  return active ? (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path fill="currentColor" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round"
        d="M3.5 10.5 12 3.6l8.5 6.9V19a1.6 1.6 0 0 1-1.6 1.6H5.1A1.6 1.6 0 0 1 3.5 19z" />
      <rect x="9.6" y="14.2" width="4.8" height="7.2" rx="1.2" style={cutout} />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M3.5 10.5 12 3.6l8.5 6.9V19a1.6 1.6 0 0 1-1.6 1.6H5.1A1.6 1.6 0 0 1 3.5 19z" />
      <path d="M9.8 20.6v-5.2a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1v5.2" />
    </svg>
  )
}

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
      <path d="M12 8.6v10.2" strokeWidth={1.6} strokeLinecap="round" style={{ stroke: 'var(--color-bg)' }} />
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
