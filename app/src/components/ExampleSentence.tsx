import type { ReactNode } from 'react'
import { tokenizeSentence } from '../lib/lookup'

/** 例句：目标词（词下标 w）加粗高亮；没有下标时按词形匹配 */
export function HighlightedSentence({ text, w, term }: { text: string; w?: number; term?: string }) {
  const tokens = tokenizeSentence(text)
  const lower = term?.toLowerCase()
  const nodes: ReactNode[] = []
  let cursor = 0
  tokens.forEach((token, i) => {
    const hit = w !== undefined ? i === w : !!lower && token.text.toLowerCase().startsWith(lower)
    if (!hit) return
    if (token.start > cursor) nodes.push(text.slice(cursor, token.start))
    nodes.push(<mark key={i} className="example-hit">{token.text}</mark>)
    cursor = token.end
  })
  nodes.push(text.slice(cursor))
  return <>{nodes}</>
}
