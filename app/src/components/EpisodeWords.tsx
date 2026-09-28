import { useEffect, useMemo, useState } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useCards } from '../hooks/useCards'
import { addToReview, isMastered, markKnown } from '../lib/srs'
import { loadWordbookMap } from '../lib/wordbook'
import type { BookWord } from '../lib/wordbook'
import { normalizeTerm, tokenizeSentence } from '../lib/lookup'
import type { TalkData } from '../lib/types'
import type { CardContext } from '../lib/db'

/** 本集里某个六级词第一次出现的那一句，作为它的亲历语境 */
function firstContext(talk: TalkData, match: (surface: string) => boolean): CardContext | undefined {
  for (const s of talk.sentences) {
    const tokens = tokenizeSentence(s.en)
    const w = tokens.findIndex(t => match(normalizeTerm(t.text)))
    if (w >= 0) return { slug: talk.slug, i: s.i, en: s.en, zh: s.zh, start: s.start, end: s.end, w }
  }
  return undefined
}

/**
 * 本集词汇：节目官方重点词 + 本集出现的六级词。
 * 听前扫一眼生词、听后一次性勾"认识/不认识"，不认识的带着本集这一句进复习。
 */
export default function EpisodeWords({ talk, onClose }: { talk: TalkData; onClose: () => void }) {
  const { cards } = useCards()
  const [book, setBook] = useState<Map<string, BookWord>>(new Map())
  const [showMastered, setShowMastered] = useState(false)
  const [showBasic, setShowBasic] = useState(false)

  useEffect(() => {
    loadWordbookMap().then(setBook).catch(() => setBook(new Map()))
  }, [])

  const groups = useMemo(() => {
    const lemmas = [...new Set(Object.values(talk.lemmas ?? {}))]
      .sort((a, b) => (book.get(a)?.index ?? 1e9) - (book.get(b)?.index ?? 1e9))
    const fresh: string[] = []
    const basic: string[] = []
    const learning: string[] = []
    const mastered: string[] = []
    for (const lemma of lemmas) {
      const card = cards.get(lemma)
      if (!card) (book.get(lemma)?.tier === 6 ? fresh : basic).push(lemma)
      else if (isMastered(card)) mastered.push(lemma)
      else learning.push(lemma)
    }
    return { fresh, basic, learning, mastered }
  }, [talk, cards, book])

  const inputFor = (lemma: string) => {
    const entry = book.get(lemma)
    return {
      term: lemma,
      kind: 'word' as const,
      inBook: true,
      meaning: entry?.zh ?? '',
      phonetic: entry?.ph,
      context: firstContext(talk, surface => talk.lemmas?.[surface] === lemma),
    }
  }

  const addKeyword = (term: string, def: string) => {
    const key = normalizeTerm(term.split(/\s*\/\s*/)[0].replace(/\(.*?\)/g, '').trim())
    const head = key.split(' ')[0]
    void addToReview({
      term: key,
      kind: key.includes(' ') ? 'phrase' : 'word',
      inBook: book.has(key),
      meaning: def,
      phonetic: book.get(key)?.ph,
      context: firstContext(talk, surface => surface === head || surface.startsWith(head)),
    })
  }

  const wordRow = (lemma: string) => (
    <li key={lemma} className="episode-word">
      <div className="min-w-0">
        <p className="episode-word-term">{lemma}</p>
        <p className="episode-word-def">{book.get(lemma)?.zh}</p>
      </div>
      <div className="episode-word-buttons">
        <button className="pill-button is-soft is-small" onClick={() => markKnown(inputFor(lemma))}>认识</button>
        <button className="pill-button is-small" onClick={() => addToReview(inputFor(lemma))}>不认识</button>
      </div>
    </li>
  )

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent side="bottom" className="app-sheet">
        <SheetTitle className="app-sheet-title">本集词汇</SheetTitle>
        <div className="app-sheet-body no-scrollbar vertical-scroll">
          <p className="episode-words-summary">
            六级词 {groups.fresh.length + groups.basic.length + groups.learning.length + groups.mastered.length} 个 ·
            新词未学 {groups.fresh.length} · 在学 {groups.learning.length} · 已掌握 {groups.mastered.length}
          </p>

          {talk.keywords.length > 0 && (
            <section>
              <h3 className="group-title">节目重点词</h3>
              <ul className="episode-words-list">
                {talk.keywords.map(k => {
                  const key = normalizeTerm(k.term.split(/\s*\/\s*/)[0].replace(/\(.*?\)/g, '').trim())
                  const added = cards.has(key)
                  return (
                    <li key={k.term} className="episode-word">
                      <div className="min-w-0">
                        <p className="episode-word-term">{k.term}</p>
                        <p className="episode-word-def" lang="en">{k.def}</p>
                      </div>
                      <button className={`pill-button is-small ${added ? 'is-soft' : ''}`} disabled={added}
                        onClick={() => addKeyword(k.term, k.def)}>
                        {added ? '已加入' : '加入复习'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {groups.fresh.length > 0 && (
            <section>
              <h3 className="group-title">没学过的六级新词 · 字幕里虚线标出</h3>
              <ul className="episode-words-list">{groups.fresh.map(wordRow)}</ul>
            </section>
          )}

          {groups.basic.length > 0 && (
            <section>
              <button className="episode-words-toggle" onClick={() => setShowBasic(v => !v)} aria-expanded={showBasic}>
                四级基础词 {groups.basic.length} 个 · {showBasic ? '收起' : '展开'}
              </button>
              {showBasic && <ul className="episode-words-list">{groups.basic.map(wordRow)}</ul>}
            </section>
          )}

          {groups.learning.length > 0 && (
            <section>
              <h3 className="group-title">正在学的词 · 字幕里粉底标出</h3>
              <p className="episode-word-chips">
                {groups.learning.map(lemma => <span key={lemma}>{lemma}</span>)}
              </p>
            </section>
          )}

          {groups.mastered.length > 0 && (
            <section>
              <button className="episode-words-toggle" onClick={() => setShowMastered(v => !v)} aria-expanded={showMastered}>
                已掌握 {groups.mastered.length} 个 · {showMastered ? '收起' : '展开'}
              </button>
              {showMastered && (
                <p className="episode-word-chips is-muted">
                  {groups.mastered.map(lemma => <span key={lemma}>{lemma}</span>)}
                </p>
              )}
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
